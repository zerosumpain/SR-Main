import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { and, or, sql, ilike, gte, lte, inArray, isNotNull, type SQL } from 'drizzle-orm';
import {
  buildOpenWeightResolver,
  type OpenWeightResolver,
  type OpenWeightSource,
} from '$lib/models/open-weights';
import { getSetting } from '$lib/server/models/settings';

interface RawBenchmarks {
  intelligence_index?: number;
  coding_index?: number;
  agentic_index?: number;
}

/** Which Artificial Analysis index the score's quality axis reads. The picker
 *  exposes this because "quality" means different things per task: agentic for
 *  the tool-driving orchestrator, coding for code work, intelligence for
 *  general reasoning.
 *
 *  NOT exported — SvelteKit only permits HTTP-method exports from `+server.ts`
 *  and rejects the module at runtime otherwise (a 500 with no build error, as
 *  svelte-check doesn't model that rule). The picker keeps its own copy of the
 *  list; the `qualityMetric` query param is the contract between them. */
const QUALITY_METRICS = ['agentic', 'coding', 'intelligence'] as const;
type QualityMetric = (typeof QUALITY_METRICS)[number];

const QUALITY_FIELD: Record<QualityMetric, keyof Pick<
  EnrichedRow,
  'agenticIndex' | 'codingIndex' | 'intelligenceIndex'
>> = {
  agentic: 'agenticIndex',
  coding: 'codingIndex',
  intelligence: 'intelligenceIndex',
};

type Row = typeof openrouterModels.$inferSelect;

interface EnrichedRow extends Row {
  toolsSupported: boolean;
  /** True when the model publishes its weights — see $lib/models/open-weights
   *  (OpenRouter `hugging_face_id` + sibling inheritance + override map).
   *  Drives the OPEN badge + "open only" filter in the /jkai picker and the
   *  open-weight bias in $lib/routing/scoring. */
  openWeights: boolean;
  /** The Hugging Face repo backing an open-weight model. Null when closed AND
   *  when open with no published repo — read `openWeights`, not this. */
  huggingFaceId: string | null;
  /** Which detection layer decided it; shown in the badge tooltip. */
  openWeightSource: OpenWeightSource | null;
  /** Blended USD per 1M tokens at a 3:1 input:output ratio. */
  blendedPerM: number | null;
  /** Artificial Analysis indices, re-served by OpenRouter inside the raw model
   *  record. agenticIndex is the tool-use quality axis of the hybrid score. */
  agenticIndex: number | null;
  codingIndex: number | null;
  intelligenceIndex: number | null;
  /** Hybrid best-combo score in [0,1]; null for models missing the
   *  quality/price inputs (the "unrated" bucket). */
  score: number | null;
  /** The value of the selected quality metric — what `score` actually used, so
   *  the client can label the axis without re-deriving it. */
  qualityIndex: number | null;
}

function enrich(row: Row, openWeights: OpenWeightResolver, metric: QualityMetric): EnrichedRow {
  const raw = (row.raw ?? {}) as {
    supported_parameters?: unknown;
    benchmarks?: { artificial_analysis?: RawBenchmarks };
  };
  const supported = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
  const bench = raw.benchmarks?.artificial_analysis ?? {};
  const prompt = row.promptPrice != null ? Number(row.promptPrice) : null;
  const completion = row.completionPrice != null ? Number(row.completionPrice) : null;
  // OpenRouter uses -1 as a "variable pricing" sentinel on router pseudo-models
  // (openrouter/auto) — treat negative prices as unpriced.
  const blendedPerM =
    prompt != null && completion != null &&
    Number.isFinite(prompt) && Number.isFinite(completion) &&
    prompt >= 0 && completion >= 0
      ? ((3 * prompt + completion) / 4) * 1_000_000
      : null;
  const verdict = openWeights.verdict(row.id);
  const enriched: EnrichedRow = {
    ...row,
    toolsSupported: supported.includes('tools'),
    openWeights: verdict.open,
    huggingFaceId: verdict.huggingFaceId,
    openWeightSource: verdict.source,
    blendedPerM,
    agenticIndex: typeof bench.agentic_index === 'number' ? bench.agentic_index : null,
    codingIndex: typeof bench.coding_index === 'number' ? bench.coding_index : null,
    intelligenceIndex: typeof bench.intelligence_index === 'number' ? bench.intelligence_index : null,
    score: null,
    qualityIndex: null,
  };
  enriched.qualityIndex = enriched[QUALITY_FIELD[metric]];
  return enriched;
}

/** Hybrid score: weighted combo of quality (the selected Artificial Analysis
 *  index), price (log-scaled, cheaper = better) and token speed (log-scaled p50
 *  throughput). Min-max normalized within the current candidate set — so a
 *  score is a RANK WITHIN THE ACTIVE FILTER, not an absolute rating. Models
 *  missing quality or price stay unrated (score null), never fake-ranked;
 *  missing throughput scores neutral (0.5) rather than being punished. */
function applyHybridScores(rows: EnrichedRow[], wq: number, wp: number, wt: number): void {
  const rated = rows.filter((r) => r.qualityIndex != null && r.blendedPerM != null && r.blendedPerM > 0);
  if (!rated.length) return;
  const q = rated.map((r) => r.qualityIndex!);
  const p = rated.map((r) => Math.log(r.blendedPerM!));
  const t = rated.filter((r) => r.throughput != null).map((r) => Math.log(Math.max(0.1, Number(r.throughput))));
  const [qMin, qMax] = [Math.min(...q), Math.max(...q)];
  const [pMin, pMax] = [Math.min(...p), Math.max(...p)];
  const [tMin, tMax] = t.length ? [Math.min(...t), Math.max(...t)] : [0, 0];
  const norm = (v: number, min: number, max: number) => (max > min ? (v - min) / (max - min) : 0.5);

  const wSum = wq + wp + wt || 1;
  for (const r of rated) {
    const qn = norm(r.qualityIndex!, qMin, qMax);
    const pn = 1 - norm(Math.log(r.blendedPerM!), pMin, pMax); // cheaper → 1
    const tn = r.throughput != null ? norm(Math.log(Math.max(0.1, Number(r.throughput))), tMin, tMax) : 0.5;
    r.score = (wq * qn + wp * pn + wt * tn) / wSum;
  }
}

// Sort-value extractor per column. Numeric extractors return null for missing
// values; nulls always sink to the bottom regardless of direction (the SQL
// NULLS LAST behaviour this endpoint used to get from Postgres).
const SORT_VALUE: Record<string, (r: EnrichedRow) => string | number | null> = {
  id: (r) => r.id,
  name: (r) => r.name,
  provider: (r) => r.provider,
  modality: (r) => r.modality,
  contextLength: (r) => r.contextLength,
  promptPrice: (r) => (r.promptPrice != null ? Number(r.promptPrice) : null),
  completionPrice: (r) => (r.completionPrice != null ? Number(r.completionPrice) : null),
  throughput: (r) => (r.throughput != null ? Number(r.throughput) : null),
  blendedPerM: (r) => r.blendedPerM,
  agenticIndex: (r) => r.agenticIndex,
  codingIndex: (r) => r.codingIndex,
  intelligenceIndex: (r) => r.intelligenceIndex,
  // Follows the selected metric, so the picker's "quality" sort tracks whatever
  // the user chose without needing to know the column name.
  qualityIndex: (r) => r.qualityIndex,
  score: (r) => r.score,
  toolsSupported: (r) => (r.toolsSupported ? 1 : 0),
  openWeights: (r) => (r.openWeights ? 1 : 0),
};

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  const providers = url.searchParams.getAll('provider').filter(Boolean);
  const modalities = url.searchParams.getAll('modality').filter(Boolean);
  const minContext = num(url.searchParams.get('minContext'));
  const maxCostPerM = num(url.searchParams.get('maxCostPerM')); // USD per 1M completion tokens
  const page = Math.max(1, num(url.searchParams.get('page')) ?? 1);
  const pageSize = Math.min(500, Math.max(1, num(url.searchParams.get('pageSize')) ?? 50));
  const sortBy = url.searchParams.get('sortBy') ?? 'id';
  const sortDirParam = url.searchParams.get('sortDir');
  const sortDir = sortDirParam === 'desc' ? 'desc' : sortDirParam === 'asc' ? 'asc' : defaultDir(sortBy);
  // toolsOnly: restrict to models whose supported_parameters include "tools".
  // The jkai orchestrator is an agent and requires tool use — models without it
  // (e.g. morph/relace "apply" models) 404 with "No endpoints found that
  // support tool use". The chat model picker sets this.
  const toolsOnly = url.searchParams.get('toolsOnly') === '1';
  // openOnly: restrict to open-weight models. Applied in JS after enrichment
  // (not as SQL on hugging_face_id) so the chip and the OPEN badge are driven by
  // exactly the same resolver — including the models OpenRouter leaves blank.
  const openOnly = url.searchParams.get('openOnly') === '1';
  // imageOut: restrict to models that EMIT images, for the image-generation
  // workload. Mutually sensible with toolsOnly=0 — image models rarely
  // advertise tool support, so asking for both returns nothing.
  const imageOut = url.searchParams.get('imageOut') === '1';
  // Hybrid-score weights (quality / price / throughput). Scores are computed on
  // every request so the Score column is populated in any sort mode.
  // Which Artificial Analysis index the quality axis reads. Unknown values fall
  // back to agentic rather than erroring — a stale bookmark shouldn't 400.
  const metricParam = url.searchParams.get('qualityMetric');
  const qualityMetric: QualityMetric = (QUALITY_METRICS as readonly string[]).includes(
    metricParam ?? '',
  )
    ? (metricParam as QualityMetric)
    : 'agentic';
  const wq = num(url.searchParams.get('wq')) ?? 0.5;
  const wp = num(url.searchParams.get('wp')) ?? 0.3;
  const wt = num(url.searchParams.get('wt')) ?? 0.2;

  const sortValue = SORT_VALUE[sortBy];
  if (!sortValue) throw error(400, `invalid sortBy: ${sortBy}`);

  const conditions: SQL[] = [];
  if (q) conditions.push(or(ilike(openrouterModels.name, `%${q}%`), ilike(openrouterModels.id, `%${q}%`))!);
  if (providers.length) conditions.push(inArray(openrouterModels.provider, providers));
  if (modalities.length) conditions.push(inArray(openrouterModels.modality, modalities));
  if (minContext != null) conditions.push(gte(openrouterModels.contextLength, minContext));
  if (maxCostPerM != null) {
    // maxCostPerM is USD per 1M completion tokens; completion_price is USD per token
    conditions.push(lte(openrouterModels.completionPrice, String(maxCostPerM / 1_000_000)));
  }
  if (toolsOnly) {
    conditions.push(sql`(${openrouterModels.raw} -> 'supported_parameters') @> '["tools"]'::jsonb`);
  }
  if (imageOut) {
    // Modality reads `inputs->outputs`, so the OUTPUT side is everything after
    // the arrow. Matching the whole string would return every vision model —
    // which reads images and can only write text, and is exactly the wrong
    // answer for a picker choosing an image GENERATOR (11 rows qualify, ~200
    // would otherwise). Mirrors `emitsImages()` in $lib/models/workloads.
    conditions.push(sql`split_part(${openrouterModels.modality}, '->', 2) LIKE '%image%'`);
  }

  const where = conditions.length ? and(...conditions) : undefined;

  // The catalogue is small (~350 rows), so the filtered set is loaded whole,
  // enriched + scored + sorted in JS, and paginated here. That is what lets
  // every column — including the derived ones (score, agentic, blended price,
  // tools) — sort without SQL expressions.
  // Facets stay distinct across the entire catalogue so users always see the
  // full option list.
  const [providerRows, modalityRows, all, catalogueIds] = await Promise.all([
    db
      .selectDistinct({ value: openrouterModels.provider })
      .from(openrouterModels)
      .where(isNotNull(openrouterModels.provider))
      .orderBy(openrouterModels.provider),
    db
      .selectDistinct({ value: openrouterModels.modality })
      .from(openrouterModels)
      .where(isNotNull(openrouterModels.modality))
      .orderBy(openrouterModels.modality),
    db.select().from(openrouterModels).where(where),
    // Unfiltered — sibling inheritance has to see the base model even when the
    // active filter excludes it (searching "turbo" must still resolve glm-5).
    db.select({ id: openrouterModels.id, raw: openrouterModels.raw }).from(openrouterModels),
  ]);

  const openWeights = buildOpenWeightResolver(catalogueIds);
  // openOnly narrows BEFORE scoring so the hybrid score stays min-max normalised
  // within the set actually on screen (what the SQL filter used to do).
  const rows = all
    .map((row) => enrich(row, openWeights, qualityMetric))
    .filter((r) => !openOnly || r.openWeights);
  applyHybridScores(rows, wq, wp, wt);

  const dir = sortDir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const va = sortValue(a);
    const vb = sortValue(b);
    if (va == null && vb == null) return a.id.localeCompare(b.id);
    if (va == null) return 1; // nulls sink regardless of direction
    if (vb == null) return -1;
    const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
    return cmp === 0 ? a.id.localeCompare(b.id) : dir * cmp;
  });

  const paged = rows.slice((page - 1) * pageSize, page * pageSize);
  const lastRefreshed = await getSetting<string>('openrouter.last_refreshed_at');

  return json({
    rows: paged,
    total: rows.length,
    page,
    pageSize,
    lastRefreshed,
    sortBy,
    sortDir,
    qualityMetric,
    weights: { wq, wp, wt },
    /** How many rows in the CURRENT filter actually carry each input, so the
     *  UI can say what the score is standing on rather than implying coverage
     *  it doesn't have. */
    coverage: {
      total: rows.length,
      quality: rows.filter((r) => r.qualityIndex != null).length,
      price: rows.filter((r) => r.blendedPerM != null && r.blendedPerM > 0).length,
      throughput: rows.filter((r) => r.throughput != null).length,
      scored: rows.filter((r) => r.score != null).length,
    },
    facets: {
      providers: providerRows.map((r) => r.value).filter((v): v is string => v != null),
      modalities: modalityRows.map((r) => r.value).filter((v): v is string => v != null),
    },
  });
};

/** Best-first default per column: quality/speed/context/tools read best
 *  descending, prices ascending (cheapest first), text ascending. */
function defaultDir(sortBy: string): 'asc' | 'desc' {
  return [
    'score',
    'agenticIndex',
    'codingIndex',
    'intelligenceIndex',
    'qualityIndex',
    'throughput',
    'contextLength',
    'toolsSupported',
  ].includes(sortBy)
    ? 'desc'
    : 'asc';
}

function num(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
