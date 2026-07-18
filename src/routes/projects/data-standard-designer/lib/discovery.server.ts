// Emerging-standards discovery — the robust mechanism behind the portal.
//
// Design principle (the thing that makes this trustworthy): DISCOVERY is
// index-driven and deterministic — it reads official, timestamped, paginated
// indexes (the GOV.UK Search API, GitHub org search) that report a TOTAL count.
// We never "ask an LLM what standards are new" (that hallucinates and silently
// misses). The LLM is used only to CLASSIFY/summarise items already found, and
// its failure can never hide a standard. Every source records a telemetry row
// (found / new / upstream-total / ok / error) so a silently-broken feed is
// visible rather than mistaken for "nothing new".

import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { standardRegistryEntries, standardRegistrySourceRuns } from '$lib/db/schema';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';

export interface Candidate {
  canonicalId: string;
  title: string;
  url: string;
  sourceKey: string;
  sourceQuery?: string;
  publisher?: string;
  docType?: string;
  publishedAt?: Date | null;
  description?: string;
  watch?: string; // named watch that surfaced this candidate
  raw?: unknown;
}

// Named "watches" — focused query sets the daily sweep runs so specific,
// anticipated publications are caught the moment they appear. Matches are
// tagged and surfaced in the portal. Add more watches here as needed.
export interface Watch {
  id: string;
  label: string;
  queries: string[];
  /** A result is only tagged with this watch if its title/description contains
   *  one of these (lowercased) phrases — GOV.UK Search ranks loosely by recency,
   *  so this precision filter keeps the watch from tagging unrelated items. */
  mustMatch: string[];
}
export const WATCHES: Watch[] = [
  {
    id: 'cwsa',
    label: "Children's Wellbeing and Schools Act — guidance & data",
    queries: [
      '"Children\'s Wellbeing and Schools Act"',
      '"consistent identifier" children',
      '"single unique identifier" children',
      '"children not in school"',
      'safeguarding children information sharing statutory guidance',
      'working together to safeguard children',
    ],
    mustMatch: [
      "children's wellbeing and schools",
      'childrens wellbeing and schools',
      'consistent identifier',
      'single unique identifier',
      'children not in school',
      'safeguard children',
      'safeguarding children',
      'information sharing duty',
      'multi-agency child protection',
      'safeguarding partners',
      "children's social care reform",
      "children's social care reset",
    ],
  },
];
export const WATCH_LABELS: Record<string, string> = Object.fromEntries(WATCHES.map((w) => [w.id, w.label]));

interface SourceResult {
  sourceKey: string;
  candidates: Candidate[];
  totalAvailable: number | null;
  ok: boolean;
  error?: string;
}

const UA = 'strangeramblings-data-standard-designer/1.0 (discovery)';

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 20000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json', ...(init?.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// --- Source 1: GOV.UK Search API (the backbone) ---------------------------
// Curated queries targeting standards-shaped content. The API returns a
// `total` per query — summed into the coverage signal.
const GOVUK_QUERIES = [
  '"data standard"',
  '"data dictionary"',
  '"data model"',
  '"metadata standard"',
  '"open standard"',
  '"API standard"',
  '"data sharing" standard',
  'interoperability standard data',
];

async function govukSearch(): Promise<SourceResult> {
  const map = new Map<string, Candidate>();
  let total = 0;
  let anyOk = false;
  let firstErr: string | undefined;
  // Watch queries run FIRST so their matches carry the watch tag; generic
  // queries for the same item are then skipped (the map keeps the tagged one).
  const queries: { q: string; watch?: string; mustMatch?: string[] }[] = [
    ...WATCHES.flatMap((w) => w.queries.map((q) => ({ q, watch: w.id, mustMatch: w.mustMatch }))),
    ...GOVUK_QUERIES.map((q) => ({ q })),
  ];
  for (const { q, watch, mustMatch } of queries) {
    // generic discovery sorts by recency (what's NEW); watches sort by relevance
    // (the most on-topic items for the phrase), then a precision filter.
    const order = watch ? '' : '&order=-public_timestamp';
    const url = `https://www.gov.uk/api/search.json?q=${encodeURIComponent(q)}&count=25${order}&fields=title,link,public_timestamp,organisations,content_store_document_type,description`;
    try {
      const data = await fetchJson(url);
      // only the generic queries contribute to the coverage total (watch queries
      // are narrow subsets and would distort it)
      if (!watch) total += Number(data?.total || 0);
      anyOk = true;
      for (const r of data?.results || []) {
        // watch precision filter: skip results that don't actually mention the topic
        if (watch && mustMatch) {
          const hay = `${r.title || ''} ${r.description || ''}`.toLowerCase();
          if (!mustMatch.some((m) => hay.includes(m))) continue;
        }
        const link = r.link?.startsWith('http') ? r.link : `https://www.gov.uk${r.link}`;
        const canonicalId = `govuk:${r.link}`;
        if (map.has(canonicalId)) continue;
        const org = (r.organisations || [])[0];
        map.set(canonicalId, {
          canonicalId,
          title: String(r.title || r.link),
          url: link,
          sourceKey: 'govuk-search',
          sourceQuery: q,
          watch,
          publisher: org?.title || org?.acronym,
          docType: r.content_store_document_type,
          publishedAt: r.public_timestamp ? new Date(r.public_timestamp) : null,
          description: r.description ? String(r.description).slice(0, 400) : undefined,
          raw: r,
        });
      }
    } catch (e: any) {
      firstErr = firstErr || `${q}: ${e?.message || 'failed'}`;
    }
  }
  return { sourceKey: 'govuk-search', candidates: [...map.values()], totalAvailable: anyOk ? total : null, ok: anyOk, error: anyOk ? undefined : firstErr };
}

// --- Source 2: GitHub org search (secondary, catches code-first standards) -
const GH_ORGS = ['dfe-digital', 'NHSDigital', 'alphagov', 'co-cddo', 'GSS-Cogs'];

async function githubSearch(): Promise<SourceResult> {
  const map = new Map<string, Candidate>();
  let total = 0;
  let anyOk = false;
  let firstErr: string | undefined;
  for (const org of GH_ORGS) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`org:${org} standard in:name,description,topics`)}&sort=updated&per_page=15`;
    try {
      const data = await fetchJson(url, { headers: { accept: 'application/vnd.github+json' } });
      total += Number(data?.total_count || 0);
      anyOk = true;
      for (const r of data?.items || []) {
        const canonicalId = `github:${r.full_name}`;
        if (map.has(canonicalId)) continue;
        map.set(canonicalId, {
          canonicalId,
          title: r.full_name,
          url: r.html_url,
          sourceKey: 'github',
          sourceQuery: `org:${org}`,
          publisher: org,
          docType: 'repository',
          publishedAt: r.pushed_at ? new Date(r.pushed_at) : null,
          description: r.description ? String(r.description).slice(0, 400) : undefined,
          raw: { full_name: r.full_name, description: r.description, topics: r.topics, stars: r.stargazers_count },
        });
      }
    } catch (e: any) {
      firstErr = firstErr || `${org}: ${e?.message || 'failed'}`;
    }
  }
  return { sourceKey: 'github', candidates: [...map.values()], totalAvailable: anyOk ? total : null, ok: anyOk, error: anyOk ? undefined : firstErr };
}

const SOURCES = [govukSearch, githubSearch];

// --- LLM classification (enrichment only; never gates existence) -----------
interface Classification {
  kind: string;
  confidence: 'high' | 'medium' | 'low';
  domain: string;
  summary: string;
  isStandard: boolean;
}

async function classifyBatch(items: Candidate[]): Promise<Map<string, Classification>> {
  const out = new Map<string, Classification>();
  if (!items.length) return out;
  const { client, model } = await getLLMClient(await resolveDefaultModel('chat'));
  const payload = items.map((c, i) => ({ i, title: c.title, publisher: c.publisher, docType: c.docType, url: c.url, description: c.description }));
  const sys =
    'You classify UK government publications for a registry of DATA STANDARDS. For each item decide: is it actually a data standard, data dictionary, metadata standard, API/technical data standard, identifier scheme, or closely-related guidance — versus unrelated news/policy/forms. Return STRICT JSON: {"items":[{"i":<index>,"isStandard":<bool>,"kind":"data-standard|data-dictionary|metadata|api-standard|identifier|guidance|other","confidence":"high|medium|low","domain":"education|childrens-social-care|child-protection|health|local-gov|cross-gov|metadata|other","summary":"<=160 chars"}]}. Be conservative: news, consultations, statistics releases and forms are "other" with isStandard=false.';
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: JSON.stringify({ items: payload }) },
      ],
      temperature: 0.1,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(res.choices?.[0]?.message?.content ?? '{}');
    for (const c of parsed?.items || []) {
      const cand = items[c.i];
      if (!cand) continue;
      out.set(cand.canonicalId, {
        kind: String(c.kind || 'other'),
        confidence: ['high', 'medium', 'low'].includes(c.confidence) ? c.confidence : 'low',
        domain: String(c.domain || 'other'),
        summary: String(c.summary || '').slice(0, 200),
        isStandard: !!c.isStandard,
      });
    }
  } catch {
    // Classification failure must NOT hide standards — leave them unclassified.
  }
  return out;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function hashOf(c: Candidate): Promise<string> {
  const basis = `${c.title}|${c.publishedAt?.toISOString() || ''}|${c.description || ''}`;
  // simple stable hash (no crypto dependency needed for change-detection)
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) { h ^= basis.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

export interface DiscoverySummary {
  ranAt: string;
  sources: { sourceKey: string; ok: boolean; found: number; new: number; totalAvailable: number | null; error?: string }[];
  classified: number;
  totalCandidates: number;
  throttled?: boolean;
}

let running = false;
let lastRunMs = 0;
let lastSummary: DiscoverySummary | null = null;
const MIN_INTERVAL_MS = 5 * 60 * 1000; // throttle manual refreshes; the daily cron is never affected
const MAX_CLASSIFY_PER_RUN = 30; // bound LLM work per sweep so it never exceeds the request timeout

/** Run a full discovery pass: fetch all sources, dedup, classify NEW/changed
 *  items, upsert, and record per-source telemetry. Safe to over-call — a
 *  5-minute throttle protects the open ingest endpoint from abuse (pass
 *  force:true to bypass; the cron does not need to). */
export async function runDiscovery(opts: { classify?: boolean; force?: boolean } = {}): Promise<DiscoverySummary> {
  if (running) return lastSummary ?? { ranAt: new Date().toISOString(), sources: [], classified: 0, totalCandidates: 0 };
  if (!opts.force && lastSummary && Date.now() - lastRunMs < MIN_INTERVAL_MS) {
    return { ...lastSummary, throttled: true } as DiscoverySummary;
  }
  running = true;
  lastRunMs = Date.now();
  const ranAt = new Date();
  try {
    const sourceResults: SourceResult[] = [];
    for (const src of SOURCES) {
      const t0 = Date.now();
      let r: SourceResult;
      try {
        r = await src();
      } catch (e: any) {
        r = { sourceKey: 'unknown', candidates: [], totalAvailable: null, ok: false, error: e?.message || 'source failed' };
      }
      sourceResults.push(r);
      // telemetry written after we know how many were new (below)
      (r as any)._durationMs = Date.now() - t0;
    }

    // existing entries (for change-detection + whether classification is needed)
    const existing = await db
      .select({ canonicalId: standardRegistryEntries.canonicalId, contentHash: standardRegistryEntries.contentHash, kind: standardRegistryEntries.kind })
      .from(standardRegistryEntries);
    const known = new Map(existing.map((e) => [e.canonicalId, { hash: e.contentHash || '', kind: e.kind || '' }]));

    const allCandidates = sourceResults.flatMap((r) => r.candidates);
    const hashes = new Map<string, string>();
    for (const c of allCandidates) hashes.set(c.canonicalId, await hashOf(c));

    // PHASE 1 — upsert EVERY candidate immediately. Existence never depends on
    // the LLM: even if classification is slow or fails, the registry is
    // populated. New / unclassified rows are flagged 'review' until classified.
    const newByCanonical = new Set<string>();
    for (const c of allCandidates) {
      const isNew = !known.has(c.canonicalId);
      if (isNew) newByCanonical.add(c.canonicalId);
      const base = {
        title: c.title,
        url: c.url,
        sourceKey: c.sourceKey,
        sourceQuery: c.sourceQuery,
        publisher: c.publisher,
        docType: c.docType,
        publishedAt: c.publishedAt ?? null,
        contentHash: hashes.get(c.canonicalId),
        raw: c.raw as any,
        lastSeenAt: ranAt,
        ...(c.watch ? { watch: c.watch } : {}), // only set (never clear) the watch tag
      };
      try {
        await db
          .insert(standardRegistryEntries)
          .values({ canonicalId: c.canonicalId, firstSeenAt: ranAt, status: 'review', ...base })
          // existing rows keep their status/kind/summary (incl. human overrides)
          .onConflictDoUpdate({ target: standardRegistryEntries.canonicalId, set: base });
      } catch {
        /* skip a bad row, keep going */
      }
    }

    // PHASE 2 — classify a BOUNDED subset that needs it (new, changed, or never
    // classified), so each sweep stays well under the request timeout. The
    // daily cron drains any backlog over subsequent runs.
    let classified = 0;
    if (opts.classify !== false) {
      const needs = allCandidates.filter((c) => {
        const k = known.get(c.canonicalId);
        return !k || k.hash !== hashes.get(c.canonicalId) || !k.kind;
      });
      const toClassify = needs.slice(0, MAX_CLASSIFY_PER_RUN);
      const t0 = Date.now();
      for (const batch of chunk(toClassify, 12)) {
        if (Date.now() - t0 > 60_000) break; // hard time budget for classification
        const m = await classifyBatch(batch);
        for (const [cid, cls] of m) {
          const status = !cls.isStandard ? 'dismissed' : cls.confidence === 'low' ? 'review' : 'listed';
          try {
            await db
              .update(standardRegistryEntries)
              .set({ kind: cls.kind, confidence: cls.confidence, domain: cls.domain, summary: cls.summary, status })
              .where(eq(standardRegistryEntries.canonicalId, cid));
            classified++;
          } catch { /* ignore */ }
        }
      }
    }

    // write telemetry per source
    const summarySources = [];
    for (const r of sourceResults) {
      const found = r.candidates.length;
      const newCount = r.candidates.filter((c) => newByCanonical.has(c.canonicalId)).length;
      try {
        await db.insert(standardRegistrySourceRuns).values({
          sourceKey: r.sourceKey,
          runAt: ranAt,
          ok: r.ok,
          itemsFound: found,
          itemsNew: newCount,
          totalAvailable: r.totalAvailable ?? null,
          error: r.error ?? null,
          durationMs: (r as any)._durationMs ?? null,
        });
      } catch { /* ignore */ }
      summarySources.push({ sourceKey: r.sourceKey, ok: r.ok, found, new: newCount, totalAvailable: r.totalAvailable, error: r.error });
    }

    lastSummary = { ranAt: ranAt.toISOString(), sources: summarySources, classified, totalCandidates: allCandidates.length };
    return lastSummary;
  } finally {
    running = false;
  }
}

export interface RegistrySnapshot {
  entries: (typeof standardRegistryEntries.$inferSelect)[];
  sourceHealth: { sourceKey: string; runAt: string; ok: boolean; itemsFound: number; itemsNew: number; totalAvailable: number | null; error: string | null }[];
  watches: { id: string; label: string; count: number; latest: string | null }[];
}

/** Read the registry for the portal: listed/review entries + latest run per source. */
export async function getRegistrySnapshot(): Promise<RegistrySnapshot> {
  const entries = await db
    .select()
    .from(standardRegistryEntries)
    // watch-tagged items always surface (the user's explicit interest), even if
    // the classifier would otherwise dismiss them as guidance/other.
    .where(sql`${standardRegistryEntries.status} <> 'dismissed' OR ${standardRegistryEntries.watch} IS NOT NULL`)
    .orderBy(sql`coalesce(${standardRegistryEntries.publishedAt}, ${standardRegistryEntries.firstSeenAt}) desc`)
    .limit(500);

  // latest run per source (DISTINCT ON)
  const runs = await db.execute(sql`
    select distinct on (source_key) source_key, run_at, ok, items_found, items_new, total_available, error
    from standard_registry_source_runs
    order by source_key, run_at desc
  `);
  const sourceHealth = (runs.rows as any[]).map((r) => ({
    sourceKey: r.source_key,
    runAt: (r.run_at instanceof Date ? r.run_at : new Date(r.run_at)).toISOString(),
    ok: r.ok,
    itemsFound: Number(r.items_found),
    itemsNew: Number(r.items_new),
    totalAvailable: r.total_available == null ? null : Number(r.total_available),
    error: r.error ?? null,
  }));

  const watches = WATCHES.map((w) => {
    const matched = entries.filter((e) => e.watch === w.id);
    const latest = matched
      .map((e) => e.publishedAt || e.firstSeenAt)
      .filter(Boolean)
      .map((d) => (d instanceof Date ? d : new Date(d as any)).toISOString())
      .sort()
      .pop() || null;
    return { id: w.id, label: w.label, count: matched.length, latest };
  });

  return { entries, sourceHealth, watches };
}
