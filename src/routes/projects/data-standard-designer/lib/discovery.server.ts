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
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';

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
  raw?: unknown;
}

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
  for (const q of GOVUK_QUERIES) {
    const url = `https://www.gov.uk/api/search.json?q=${encodeURIComponent(q)}&count=25&order=-public_timestamp&fields=title,link,public_timestamp,organisations,content_store_document_type,description`;
    try {
      const data = await fetchJson(url);
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
          sourceKey: 'govuk-search',
          sourceQuery: q,
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
  const client = getOpenAIClient();
  const model = getModel();
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
      // GLM 5.1 burns reasoning tokens from max_tokens; this is a classification
      // task that doesn't need it.
      ...( { thinking: { type: 'disabled' } } as any),
    } as any);
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

    // existing entries (canonicalId -> contentHash) for change-detection
    const existing = await db.select({ canonicalId: standardRegistryEntries.canonicalId, contentHash: standardRegistryEntries.contentHash }).from(standardRegistryEntries);
    const known = new Map(existing.map((e) => [e.canonicalId, e.contentHash || '']));

    const allCandidates = sourceResults.flatMap((r) => r.candidates);
    // new or changed → need (re)classification
    const changed: Candidate[] = [];
    const hashes = new Map<string, string>();
    for (const c of allCandidates) {
      const h = await hashOf(c);
      hashes.set(c.canonicalId, h);
      if (!known.has(c.canonicalId) || known.get(c.canonicalId) !== h) changed.push(c);
    }

    let classifications = new Map<string, Classification>();
    let classified = 0;
    if (opts.classify !== false && changed.length) {
      for (const batch of chunk(changed, 12)) {
        const m = await classifyBatch(batch);
        for (const [k, v] of m) classifications.set(k, v);
      }
      classified = classifications.size;
    }

    // upsert every candidate (existence never depends on classification)
    const newByCanonical = new Set<string>();
    for (const c of allCandidates) {
      const cls = classifications.get(c.canonicalId);
      const isNew = !known.has(c.canonicalId);
      if (isNew) newByCanonical.add(c.canonicalId);
      // status: dismiss clearly-not-a-standard; flag low-confidence for review
      let status = 'listed';
      if (cls) {
        if (!cls.isStandard) status = 'dismissed';
        else if (cls.confidence === 'low') status = 'review';
      } else if (isNew) {
        status = 'review'; // unclassified new item → visible but flagged
      }
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
        ...(cls ? { kind: cls.kind, confidence: cls.confidence, domain: cls.domain, summary: cls.summary } : {}),
      };
      try {
        await db
          .insert(standardRegistryEntries)
          .values({ canonicalId: c.canonicalId, firstSeenAt: ranAt, status, ...base })
          .onConflictDoUpdate({
            target: standardRegistryEntries.canonicalId,
            // preserve a human's status override unless we're re-classifying a changed item
            set: cls ? { ...base, status } : base,
          });
      } catch {
        /* skip a bad row, keep going */
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
}

/** Read the registry for the portal: listed/review entries + latest run per source. */
export async function getRegistrySnapshot(): Promise<RegistrySnapshot> {
  const entries = await db
    .select()
    .from(standardRegistryEntries)
    .where(sql`${standardRegistryEntries.status} <> 'dismissed'`)
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

  return { entries, sourceHealth };
}
