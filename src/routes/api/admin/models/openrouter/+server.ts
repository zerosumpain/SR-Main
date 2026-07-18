import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { and, or, sql, ilike, gte, lte, inArray, isNotNull, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { getSetting } from '$lib/server/models/settings';

const SORT_COLUMNS: Record<string, PgColumn> = {
  id: openrouterModels.id,
  name: openrouterModels.name,
  provider: openrouterModels.provider,
  modality: openrouterModels.modality,
  contextLength: openrouterModels.contextLength,
  promptPrice: openrouterModels.promptPrice,
  completionPrice: openrouterModels.completionPrice,
  throughput: openrouterModels.throughput,
};

interface RawBenchmarks {
  intelligence_index?: number;
  coding_index?: number;
  agentic_index?: number;
}

type Row = typeof openrouterModels.$inferSelect;

interface EnrichedRow extends Row {
  toolsSupported: boolean;
  /** Blended USD per 1M tokens at a 3:1 input:output ratio. */
  blendedPerM: number | null;
  /** Artificial Analysis indices, re-served by OpenRouter inside the raw model
   *  record. agenticIndex is the tool-use quality axis of the hybrid score. */
  agenticIndex: number | null;
  codingIndex: number | null;
  intelligenceIndex: number | null;
  /** Hybrid score in [0,1] — only set when sortBy=score; null for models
   *  missing the quality/price inputs (the "unrated" bucket). */
  score: number | null;
}

function enrich(row: Row): EnrichedRow {
  const raw = (row.raw ?? {}) as {
    supported_parameters?: unknown;
    benchmarks?: { artificial_analysis?: RawBenchmarks };
  };
  const supported = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
  const bench = raw.benchmarks?.artificial_analysis ?? {};
  const prompt = row.promptPrice != null ? Number(row.promptPrice) : null;
  const completion = row.completionPrice != null ? Number(row.completionPrice) : null;
  const blendedPerM =
    prompt != null && completion != null && Number.isFinite(prompt) && Number.isFinite(completion)
      ? ((3 * prompt + completion) / 4) * 1_000_000
      : null;
  return {
    ...row,
    toolsSupported: supported.includes('tools'),
    blendedPerM,
    agenticIndex: typeof bench.agentic_index === 'number' ? bench.agentic_index : null,
    codingIndex: typeof bench.coding_index === 'number' ? bench.coding_index : null,
    intelligenceIndex: typeof bench.intelligence_index === 'number' ? bench.intelligence_index : null,
    score: null,
  };
}

/** Hybrid score: weighted combo of tool-use quality (AA agentic index), price
 *  (log-scaled, cheaper = better) and token speed (log-scaled p50 throughput).
 *  Min-max normalized within the current candidate set. Models missing quality
 *  or price stay unrated (score null) — never fake-ranked. Missing throughput
 *  is scored neutral (0.5) rather than punished. */
function applyHybridScores(rows: EnrichedRow[], wq: number, wp: number, wt: number): void {
  const rated = rows.filter((r) => r.agenticIndex != null && r.blendedPerM != null && r.blendedPerM > 0);
  if (!rated.length) return;
  const q = rated.map((r) => r.agenticIndex!);
  const p = rated.map((r) => Math.log(r.blendedPerM!));
  const t = rated.filter((r) => r.throughput != null).map((r) => Math.log(Math.max(0.1, Number(r.throughput))));
  const [qMin, qMax] = [Math.min(...q), Math.max(...q)];
  const [pMin, pMax] = [Math.min(...p), Math.max(...p)];
  const [tMin, tMax] = t.length ? [Math.min(...t), Math.max(...t)] : [0, 0];
  const norm = (v: number, min: number, max: number) => (max > min ? (v - min) / (max - min) : 0.5);

  const wSum = wq + wp + wt || 1;
  for (const r of rated) {
    const qn = norm(r.agenticIndex!, qMin, qMax);
    const pn = 1 - norm(Math.log(r.blendedPerM!), pMin, pMax); // cheaper → 1
    const tn = r.throughput != null ? norm(Math.log(Math.max(0.1, Number(r.throughput))), tMin, tMax) : 0.5;
    r.score = (wq * qn + wp * pn + wt * tn) / wSum;
  }
}

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  const providers = url.searchParams.getAll('provider').filter(Boolean);
  const modalities = url.searchParams.getAll('modality').filter(Boolean);
  const minContext = num(url.searchParams.get('minContext'));
  const maxCostPerM = num(url.searchParams.get('maxCostPerM')); // USD per 1M completion tokens
  const page = Math.max(1, num(url.searchParams.get('page')) ?? 1);
  const pageSize = Math.min(100, Math.max(1, num(url.searchParams.get('pageSize')) ?? 50));
  const sortBy = url.searchParams.get('sortBy') ?? 'id';
  const sortDirParam = url.searchParams.get('sortDir');
  // Score reads best-first by default; every other column defaults ascending.
  const sortDir =
    sortDirParam === 'desc' || (sortBy === 'score' && sortDirParam !== 'asc') ? 'desc' : 'asc';
  // toolsOnly: restrict to models whose supported_parameters include "tools".
  // The jkai orchestrator is an agent and requires tool use — models without it
  // (e.g. morph/relace "apply" models) 404 with "No endpoints found that
  // support tool use". The chat model picker sets this.
  const toolsOnly = url.searchParams.get('toolsOnly') === '1';
  // Hybrid-score weights (quality / price / throughput), used when sortBy=score.
  const wq = num(url.searchParams.get('wq')) ?? 0.5;
  const wp = num(url.searchParams.get('wp')) ?? 0.3;
  const wt = num(url.searchParams.get('wt')) ?? 0.2;

  const scoreMode = sortBy === 'score';
  const sortCol = SORT_COLUMNS[sortBy];
  if (!scoreMode && !sortCol) throw error(400, `invalid sortBy: ${sortBy}`);

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

  const where = conditions.length ? and(...conditions) : undefined;

  // Facets: distinct provider/modality across the entire catalogue (not the filtered set)
  // so users can always see the full option list. Excludes nulls.
  const [countRows, providerRows, modalityRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(openrouterModels).where(where),
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
  ]);

  let rows: EnrichedRow[];
  if (scoreMode) {
    // Score is a cross-row computation (min-max within the candidate set), so
    // load the full filtered set (~350 rows max), score in JS, paginate here.
    const all = (await db.select().from(openrouterModels).where(where)).map(enrich);
    applyHybridScores(all, wq, wp, wt);
    all.sort((a, b) => {
      if (a.score == null && b.score == null) return (a.blendedPerM ?? Infinity) - (b.blendedPerM ?? Infinity);
      if (a.score == null) return 1; // unrated bucket sinks below every rated row
      if (b.score == null) return -1;
      return sortDir === 'asc' ? a.score - b.score : b.score - a.score;
    });
    rows = all.slice((page - 1) * pageSize, page * pageSize);
  } else {
    rows = (
      await db
        .select()
        .from(openrouterModels)
        .where(where)
        // NULLS LAST so unpriced / no-throughput models never sort above real
        // values (Postgres defaults to NULLS FIRST for DESC).
        .orderBy(sql`${sortCol} ${sql.raw(sortDir === 'desc' ? 'desc' : 'asc')} nulls last`)
        .limit(pageSize)
        .offset((page - 1) * pageSize)
    ).map(enrich);
  }

  const lastRefreshed = await getSetting<string>('openrouter.last_refreshed_at');

  return json({
    rows,
    total: countRows[0]?.count ?? 0,
    page,
    pageSize,
    lastRefreshed,
    sortBy,
    sortDir,
    weights: { wq, wp, wt },
    facets: {
      providers: providerRows.map((r) => r.value).filter((v): v is string => v != null),
      modalities: modalityRows.map((r) => r.value).filter((v): v is string => v != null),
    },
  });
};

function num(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
