// intel.server.ts — the Intelligence Radar engine. A daily sweep fetches NEW UK-government
// publications, news and policy (GOV.UK Search API — timestamped, paginated, reports a total),
// dedups against the DB, then the LLM classifies each NEW item AGAINST the strategy: how it
// influences which strategies/pressures, and any considerations / misalignments. Index-driven:
// the fetch is deterministic; the LLM only enriches (its failure can never hide an item).

import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { keystoneIntel, keystoneIntelRuns } from '$lib/db/schema';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { STRATEGIES } from './strategies';
import { PRESSURES } from './pressures';
import { VALID_REFS } from './policy';
import { coerceJson } from './jsonsafe';

const UA = 'strangeramblings-keystone-intel/1.0';
const STRAT_BY_ID = Object.fromEntries(STRATEGIES.map((s) => [s.id, s.name]));
const PRESSURE_BY_ID = Object.fromEntries(PRESSURES.map((p) => [p.id, p.title]));

/** Compact index the classifier maps items onto (ids must round-trip). */
function strategyIndex(): string {
  return [
    'STRATEGIES (id — name [verdict]):',
    STRATEGIES.map((s) => `- ${s.id} — ${s.name} [${s.tier}]`).join('\n'),
    'PRESSURES (id — title):',
    PRESSURES.map((p) => `- ${p.id} — ${p.title}`).join('\n'),
  ].join('\n');
}

interface Candidate {
  canonicalId: string;
  title: string;
  url: string;
  sourceQuery: string;
  publisher?: string;
  docType?: string;
  publishedAt?: Date | null;
  description?: string;
  watch?: string;
  raw?: unknown;
}

// Named WATCHES — focused topics the sweep ALWAYS surfaces, even if the per-item classifier
// would score them low (a high-signal publication mustn't slip through). A precision filter
// (mustMatch) stops a watch tagging loosely-related items. Mirrors data-standard-designer.
export interface IntelWatch {
  id: string;
  label: string;
  queries: string[];
  mustMatch: string[];
}
export const WATCHES: IntelWatch[] = [
  {
    id: 'cwsa',
    label: 'Children’s Wellbeing & Schools Act — identifier & sharing',
    queries: ['"Children\'s Wellbeing and Schools Act"', '"consistent identifier" children', '"single unique identifier" children', 'children information sharing statutory guidance'],
    mustMatch: ["children's wellbeing and schools", 'childrens wellbeing and schools', 'consistent identifier', 'single unique identifier', 'information sharing', 'safeguard'],
  },
  {
    id: 'ndl',
    label: 'National Data Library & Modern Digital Government',
    queries: ['"National Data Library"', '"modern digital government"', 'national data library DSIT'],
    mustMatch: ['national data library', 'modern digital government', 'digital backbone'],
  },
  {
    id: 'data-law',
    label: 'Data law & access (DUAA, sharing, smart data)',
    queries: ['"Data (Use and Access) Act"', 'data protection reform government', 'smart data scheme'],
    mustMatch: ['data (use and access)', 'duaa', 'data protection', 'smart data', 'digital verification'],
  },
];
export const WATCH_LABELS: Record<string, string> = Object.fromEntries(WATCHES.map((w) => [w.id, w.label]));

// Precision matters more than recall: broad recency-ordered queries return loads
// of unrelated new gov news. So: (1) DfE/DSIT org-filtered + "data" (newest first
// — high precision), then (2) tight quoted-phrase queries across all of gov.
const ORG_DFE = 'department-for-education';
const ORG_DSIT = 'department-for-science-innovation-and-technology';
const GOVUK_SEARCHES: { q?: string; org?: string }[] = [
  { q: 'data', org: ORG_DFE },
  { q: 'children data', org: ORG_DFE },
  { q: 'data', org: ORG_DSIT },
  { q: '"consistent identifier"' },
  { q: '"single unique identifier" children' },
  { q: '"national pupil database"' },
  { q: '"data (use and access) act"' },
  { q: '"national data library"' },
  { q: '"data sharing" children' },
  { q: '"children\'s social care" data' },
  { q: '"artificial intelligence" education data' },
];

async function fetchGovuk(): Promise<{ candidates: Candidate[]; total: number | null; ok: boolean; error?: string }> {
  const map = new Map<string, Candidate>();
  let total = 0;
  let anyOk = false;
  let firstErr: string | undefined;
  // Query plan: WATCHES first (relevance order + precision filter, tagged) so a watched item
  // keeps its tag; then the precise org/phrase queries (recency order). Only the latter feed
  // the coverage total (watch queries are narrow subsets and would distort it).
  const plan: { q?: string; org?: string; watch?: string; mustMatch?: string[]; recency: boolean }[] = [
    ...WATCHES.flatMap((w) => w.queries.map((q) => ({ q, watch: w.id, mustMatch: w.mustMatch, recency: false }))),
    ...GOVUK_SEARCHES.map((s) => ({ ...s, recency: true })),
  ];
  for (const s of plan) {
    const params = new URLSearchParams();
    if (s.q) params.set('q', s.q);
    if (s.org) params.set('filter_organisations', s.org);
    params.set('count', '15');
    if (s.recency) params.set('order', '-public_timestamp');
    params.set('fields', 'title,link,public_timestamp,organisations,content_store_document_type,description');
    const url = `https://www.gov.uk/api/search.json?${params.toString()}`;
    const q = s.q ?? (s.org ?? '');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json' } });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (s.recency) total += Number(data?.total || 0);
      anyOk = true;
      for (const r of data?.results || []) {
        // watch precision filter: skip results that don't actually mention the topic
        if (s.watch && s.mustMatch) {
          const hay = `${r.title || ''} ${r.description || ''}`.toLowerCase();
          if (!s.mustMatch.some((m) => hay.includes(m))) continue;
        }
        const link = r.link?.startsWith('http') ? r.link : `https://www.gov.uk${r.link}`;
        const canonicalId = `govuk:${r.link}`;
        if (map.has(canonicalId)) continue;
        const org = (r.organisations || [])[0];
        map.set(canonicalId, {
          canonicalId,
          title: String(r.title || r.link),
          url: link,
          sourceQuery: q,
          publisher: org?.title || org?.acronym,
          docType: r.content_store_document_type,
          publishedAt: r.public_timestamp ? new Date(r.public_timestamp) : null,
          description: r.description ? String(r.description).slice(0, 500) : undefined,
          watch: s.watch,
          raw: r,
        });
      }
    } catch (e: any) {
      firstErr = firstErr || `${q}: ${e?.message || 'failed'}`;
    }
  }
  return { candidates: [...map.values()], total: anyOk ? total : null, ok: anyOk, error: anyOk ? undefined : firstErr };
}

interface Classification {
  relevance: number;
  summary: string;
  influences: { kind: 'strategy' | 'pressure'; id: string; how: string; direction: string }[];
  considerations: string[];
  misalignments: { point: string; severity: string }[];
}

const DIRECTIONS = ['reinforces', 'challenges', 'shifts', 'informs'];

async function classify(c: Candidate): Promise<Classification | null> {
  const sys = `You are the intelligence analyst for a DfE data-strategy workbench ("Keystone"). Given a new UK-government item, judge its relevance to the data strategy and HOW it bears on it, using ONLY the strategy index below.

Return STRICT JSON only:
{"relevance": 0-5,
 "summary": "<=200 chars, what it is and why it matters",
 "influences": [{"kind":"strategy"|"pressure","id":"<id from the index>","how":"<=140 chars","direction":"reinforces"|"challenges"|"shifts"|"informs"}],
 "considerations": ["<=140 chars", ...],
 "misalignments": [{"point":"where this item conflicts with / outpaces / contradicts the current strategy or its assumptions, <=160 chars","severity":"high"|"medium"|"low"}]}

Rules: relevance 0 = irrelevant, 5 = directly reshapes the strategy. Only cite ids that appear in the index. 1-4 influences, 0-3 considerations, 0-3 misalignments. If irrelevant, return relevance 0 and empty arrays. Be precise and neutral.

STRATEGY INDEX:
${strategyIndex()}`;
  const user = `NEW ITEM:\nTitle: ${c.title}\nPublisher: ${c.publisher ?? '—'}\nType: ${c.docType ?? '—'}\nDate: ${c.publishedAt?.toISOString()?.slice(0, 10) ?? '—'}\nDescription: ${c.description ?? '—'}\nURL: ${c.url}`;
  try {
    const client = getOpenAIClient();
    const res = await client.chat.completions.create(
      {
        model: getModel(),
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0.2,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
      } as any,
      { signal: AbortSignal.timeout(60_000) as any },
    );
    const p = coerceJson(res.choices?.[0]?.message?.content ?? '{}');
    const influences = (Array.isArray(p?.influences) ? p.influences : [])
      .filter((x: any) => (x?.kind === 'strategy' && VALID_REFS.strategies.has(x.id)) || (x?.kind === 'pressure' && VALID_REFS.pressures.has(x.id)))
      .map((x: any) => ({ kind: x.kind, id: x.id, how: String(x.how ?? '').slice(0, 160), direction: DIRECTIONS.includes(x.direction) ? x.direction : 'informs' }))
      .slice(0, 5);
    return {
      relevance: Math.max(0, Math.min(5, Math.round(Number(p?.relevance) || 0))),
      summary: String(p?.summary ?? '').slice(0, 260),
      influences,
      considerations: (Array.isArray(p?.considerations) ? p.considerations : []).map((s: any) => String(s).slice(0, 180)).slice(0, 4),
      misalignments: (Array.isArray(p?.misalignments) ? p.misalignments : [])
        .map((m: any) => ({ point: String(m?.point ?? m ?? '').slice(0, 200), severity: ['high', 'medium', 'low'].includes(m?.severity) ? m.severity : 'medium' }))
        .filter((m: any) => m.point)
        .slice(0, 3),
    };
  } catch {
    return null;
  }
}

function hashOf(c: Candidate): string {
  const basis = `${c.title}|${c.publishedAt?.toISOString() || ''}|${c.description || ''}`;
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) { h ^= basis.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

export interface IntelRunSummary {
  ranAt: string;
  found: number;
  new: number;
  classified: number;
  totalAvailable: number | null;
  ok: boolean;
  error?: string;
  throttled?: boolean;
}

let running = false;
let lastRunMs = 0;
let lastSummary: IntelRunSummary | null = null;
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_CLASSIFY = 16;

export async function runIntel(opts: { classify?: boolean; force?: boolean } = {}): Promise<IntelRunSummary> {
  if (running) return lastSummary ?? { ranAt: new Date().toISOString(), found: 0, new: 0, classified: 0, totalAvailable: null, ok: true };
  if (!opts.force && lastSummary && Date.now() - lastRunMs < MIN_INTERVAL_MS) return { ...lastSummary, throttled: true };
  running = true;
  lastRunMs = Date.now();
  const ranAt = new Date();
  const t0 = Date.now();
  try {
    const src = await fetchGovuk();
    const existing = await db.select({ canonicalId: keystoneIntel.canonicalId, contentHash: keystoneIntel.contentHash, status: keystoneIntel.status }).from(keystoneIntel);
    const known = new Map(existing.map((e) => [e.canonicalId, { hash: e.contentHash || '', status: e.status }]));

    let newCount = 0;
    for (const c of src.candidates) {
      const isNew = !known.has(c.canonicalId);
      if (isNew) newCount++;
      const base = {
        title: c.title, url: c.url, source: 'govuk-search', sourceQuery: c.sourceQuery,
        publisher: c.publisher, docType: c.docType, publishedAt: c.publishedAt ?? null,
        contentHash: hashOf(c), raw: c.raw as any, lastSeenAt: ranAt,
        ...(c.watch ? { watch: c.watch } : {}), // only ever SET a watch tag, never clear it
      };
      try {
        // watched items surface immediately (status 'classified') even before the classifier runs
        await db.insert(keystoneIntel).values({ canonicalId: c.canonicalId, firstSeenAt: ranAt, status: c.watch ? 'classified' : 'new', ...base })
          .onConflictDoUpdate({ target: keystoneIntel.canonicalId, set: base });
      } catch { /* skip bad row */ }
    }

    // classify a bounded subset that needs it (new or never-classified) — watched items first
    let classified = 0;
    if (opts.classify !== false) {
      const needs = src.candidates.filter((c) => {
        const k = known.get(c.canonicalId);
        return !k || k.status === 'new' || k.hash !== hashOf(c);
      }).sort((a, b) => (b.watch ? 1 : 0) - (a.watch ? 1 : 0)).slice(0, MAX_CLASSIFY);
      for (const c of needs) {
        if (Date.now() - t0 > 95_000) break; // time budget
        const cls = await classify(c);
        if (!cls) continue;
        // a watched item always surfaces, regardless of the classifier's relevance score
        const status = cls.relevance >= 2 || c.watch ? 'classified' : 'dismissed';
        try {
          await db.update(keystoneIntel).set({
            relevance: cls.relevance, summary: cls.summary, influences: cls.influences as any,
            considerations: cls.considerations as any, misalignments: cls.misalignments as any, status,
          }).where(eq(keystoneIntel.canonicalId, c.canonicalId));
          classified++;
        } catch { /* ignore */ }
      }
    }

    lastSummary = { ranAt: ranAt.toISOString(), found: src.candidates.length, new: newCount, classified, totalAvailable: src.total, ok: src.ok, error: src.error };
    try {
      await db.insert(keystoneIntelRuns).values({ runAt: ranAt, ok: src.ok, itemsFound: src.candidates.length, itemsNew: newCount, classified, error: src.error ?? null, durationMs: Date.now() - t0 });
    } catch { /* ignore */ }
    return lastSummary;
  } finally {
    running = false;
  }
}

export interface IntelItem {
  id: string;
  title: string;
  url: string;
  publisher: string | null;
  docType: string | null;
  summary: string | null;
  relevance: number;
  influences: { kind: string; id: string; label: string; how: string; direction: string }[];
  considerations: string[];
  misalignments: { point: string; severity: string }[];
  publishedAt: string | null;
  watch: string | null;
  watchLabel: string | null;
}

export interface IntelSnapshot {
  items: IntelItem[];
  watches: { id: string; label: string; count: number; latest: string | null }[];
  lastRun: { runAt: string; ok: boolean; itemsFound: number; itemsNew: number; classified: number; error: string | null } | null;
}

export async function getIntelSnapshot(): Promise<IntelSnapshot> {
  try {
    return await readSnapshot();
  } catch {
    // table not yet migrated (e.g. the homeserv dev DB) or transient DB error —
    // the radar page should render empty, never 500.
    return { items: [], watches: [], lastRun: null };
  }
}

async function readSnapshot(): Promise<IntelSnapshot> {
  const rows = await db
    .select()
    .from(keystoneIntel)
    .where(sql`${keystoneIntel.status} = 'classified'`)
    .orderBy(sql`${keystoneIntel.relevance} desc, coalesce(${keystoneIntel.publishedAt}, ${keystoneIntel.firstSeenAt}) desc`)
    .limit(60);
  const items: IntelItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    publisher: r.publisher,
    docType: r.docType,
    summary: r.summary,
    relevance: r.relevance,
    influences: ((r.influences as any[]) ?? []).map((x) => ({
      kind: x.kind, id: x.id, how: x.how, direction: x.direction,
      label: x.kind === 'strategy' ? STRAT_BY_ID[x.id] ?? x.id : PRESSURE_BY_ID[x.id] ?? x.id,
    })),
    considerations: (r.considerations as any[]) ?? [],
    misalignments: (r.misalignments as any[]) ?? [],
    publishedAt: r.publishedAt ? (r.publishedAt instanceof Date ? r.publishedAt.toISOString() : String(r.publishedAt)) : null,
    watch: r.watch ?? null,
    watchLabel: r.watch ? WATCH_LABELS[r.watch] ?? r.watch : null,
  }));
  const watches = WATCHES.map((w) => {
    const matched = items.filter((i) => i.watch === w.id);
    const latest = matched.map((i) => i.publishedAt).filter(Boolean).sort().pop() || null;
    return { id: w.id, label: w.label, count: matched.length, latest };
  });
  const runRows = await db.select().from(keystoneIntelRuns).orderBy(sql`${keystoneIntelRuns.runAt} desc`).limit(1);
  const lr = runRows[0];
  return {
    items,
    watches,
    lastRun: lr ? { runAt: lr.runAt instanceof Date ? lr.runAt.toISOString() : String(lr.runAt), ok: lr.ok, itemsFound: lr.itemsFound, itemsNew: lr.itemsNew, classified: lr.classified, error: lr.error } : null,
  };
}
