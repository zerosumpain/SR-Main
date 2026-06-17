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
  raw?: unknown;
}

const GOVUK_QUERIES = [
  'children data sharing',
  'consistent identifier children',
  'data strategy education',
  'artificial intelligence public sector data',
  'national data library',
  'pupil data protection',
  'multi-agency safeguarding data',
  'data use and access act',
  'children social care data',
  'school data collection',
];

async function fetchGovuk(): Promise<{ candidates: Candidate[]; total: number | null; ok: boolean; error?: string }> {
  const map = new Map<string, Candidate>();
  let total = 0;
  let anyOk = false;
  let firstErr: string | undefined;
  for (const q of GOVUK_QUERIES) {
    const url = `https://www.gov.uk/api/search.json?q=${encodeURIComponent(q)}&count=15&order=-public_timestamp&fields=title,link,public_timestamp,organisations,content_store_document_type,description`;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json' } });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      total += Number(data?.total || 0);
      anyOk = true;
      for (const r of data?.results || []) {
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
const MAX_CLASSIFY = 12;

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
      };
      try {
        await db.insert(keystoneIntel).values({ canonicalId: c.canonicalId, firstSeenAt: ranAt, status: 'new', ...base })
          .onConflictDoUpdate({ target: keystoneIntel.canonicalId, set: base });
      } catch { /* skip bad row */ }
    }

    // classify a bounded subset that needs it (new or never-classified)
    let classified = 0;
    if (opts.classify !== false) {
      const needs = src.candidates.filter((c) => {
        const k = known.get(c.canonicalId);
        return !k || k.status === 'new' || k.hash !== hashOf(c);
      }).slice(0, MAX_CLASSIFY);
      for (const c of needs) {
        if (Date.now() - t0 > 95_000) break; // time budget
        const cls = await classify(c);
        if (!cls) continue;
        const status = cls.relevance >= 2 ? 'classified' : 'dismissed';
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
}

export interface IntelSnapshot {
  items: IntelItem[];
  lastRun: { runAt: string; ok: boolean; itemsFound: number; itemsNew: number; classified: number; error: string | null } | null;
}

export async function getIntelSnapshot(): Promise<IntelSnapshot> {
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
  }));
  const runRows = await db.select().from(keystoneIntelRuns).orderBy(sql`${keystoneIntelRuns.runAt} desc`).limit(1);
  const lr = runRows[0];
  return {
    items,
    lastRun: lr ? { runAt: lr.runAt instanceof Date ? lr.runAt.toISOString() : String(lr.runAt), ok: lr.ok, itemsFound: lr.itemsFound, itemsNew: lr.itemsNew, classified: lr.classified, error: lr.error } : null,
  };
}
