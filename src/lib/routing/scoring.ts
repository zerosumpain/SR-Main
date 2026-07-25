// Pure, DB-free selection math. Mirrors the hybrid score in
// src/routes/api/admin/models/openrouter/+server.ts (blended 3:1 price, AA
// agentic_index quality axis, log-scaled price + throughput, min-max norm) but
// adds the per-profile policy: a capability BAND (absolute agentic-index floor,
// a fraction of the catalogue's best), a capped price weight, an open-weight
// bonus, and a success bias. Kept pure so select.test.ts can prove the guards
// without a database.
import { PRICE_WEIGHT_CAP, type ProfileWeights } from './types';

/** Success prior for a model with no rated turns yet — mildly optimistic so new
 *  models are still explored, but not enough to beat a proven one. */
export const NEUTRAL_PRIOR = 0.6;

export interface Candidate {
  id: string;
  name: string;
  toolsSupported: boolean;
  /** Blended USD per 1M tokens at 3:1 input:output; null when unpriced. */
  blendedPerM: number | null;
  /** Artificial Analysis agentic index (tool-use quality); null when unrated. */
  agenticIndex: number | null;
  /** Tokens/sec (p50); null when unknown → scored neutral. */
  throughput: number | null;
  contextLength: number | null;
  /** True when the model publishes its weights. Read from OpenRouter's
   *  `hugging_face_id` field, which is populated for open-weight models only
   *  (150 of 338 catalogue rows today) — no curated vendor list to maintain. */
  openWeights: boolean;
}

export interface ScoredCandidate extends Candidate {
  hybridScore: number;
  successRate: number | null;
  successSamples: number;
  /** hybridScore after the success bias. The value the winner is chosen on. */
  finalScore: number;
}

/** Minimal shape of an openrouter_models row (numeric columns arrive as strings). */
export interface RawModelRow {
  id: string;
  name: string;
  contextLength: number | null;
  promptPrice: string | number | null;
  completionPrice: string | number | null;
  throughput: string | number | null;
  raw: unknown;
}

export function enrichRow(row: RawModelRow): Candidate {
  const raw = (row.raw ?? {}) as {
    supported_parameters?: unknown;
    benchmarks?: { artificial_analysis?: { agentic_index?: number } };
    hugging_face_id?: unknown;
  };
  const supported = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
  const bench = raw.benchmarks?.artificial_analysis ?? {};
  const prompt = row.promptPrice != null ? Number(row.promptPrice) : null;
  const completion = row.completionPrice != null ? Number(row.completionPrice) : null;
  // OpenRouter uses -1 as a "variable pricing" sentinel — treat negatives as unpriced.
  const blendedPerM =
    prompt != null &&
    completion != null &&
    Number.isFinite(prompt) &&
    Number.isFinite(completion) &&
    prompt >= 0 &&
    completion >= 0
      ? ((3 * prompt + completion) / 4) * 1_000_000
      : null;
  const t = row.throughput != null ? Number(row.throughput) : null;
  return {
    id: row.id,
    name: row.name,
    toolsSupported: supported.includes('tools'),
    blendedPerM,
    agenticIndex: typeof bench.agentic_index === 'number' ? bench.agentic_index : null,
    throughput: t != null && Number.isFinite(t) ? t : null,
    contextLength: row.contextLength,
    openWeights: typeof raw.hugging_face_id === 'string' && raw.hugging_face_id.trim().length > 0,
  };
}

export interface SelectOpts {
  weights: ProfileWeights;
  /** Fraction of the catalogue's best agentic index a candidate must reach. */
  qualityFloorFrac: number;
  priceCeilingPerM: number;
  minContext: number;
  successBiasK: number;
  /** Multiplicative bonus for open-weight models (0.15 → ×1.15). */
  openWeightBonus: number;
  /** Exclude closed-weight models entirely. */
  openWeightsOnly: boolean;
  /** Historical first-time-correct rate (Wilson lower bound) per model id. */
  successFor: (modelId: string) => { rate: number | null; samples: number };
}

/**
 * Select the best model for one profile.
 *
 * Cost leads *within a capability band*: only candidates at/above
 * `qualityFloorFrac × the best agentic index in the catalogue` compete, and price
 * decides among them. That ordering matters — with the previous percentile floor,
 * raising the price weight made general/tool/rag all converge on the single
 * cheapest survivor and routing stopped adapting to the query.
 *
 * Open weights are favoured by a multiplicative bonus (soft) or a hard filter.
 * Price stays log-scaled and clamped to PRICE_WEIGHT_CAP so extra cheapness has
 * diminishing returns.
 */
export function selectForProfile(
  candidates: Candidate[],
  opts: SelectOpts,
): { ranked: ScoredCandidate[]; winner: ScoredCandidate | null; poolSize: number } {
  // 1. The band is anchored to the whole catalogue's ceiling, computed BEFORE any
  //    filtering so that narrowing the field (open-only, price ceiling) can never
  //    lower the quality bar.
  const bestAgentic = candidates.reduce((max, c) => Math.max(max, c.agenticIndex ?? 0), 0);
  const floor = opts.qualityFloorFrac * bestAgentic;

  // 2. Hard eligibility filter.
  const eligible = candidates.filter(
    (c) =>
      c.toolsSupported &&
      c.agenticIndex != null &&
      c.blendedPerM != null &&
      c.blendedPerM > 0 &&
      c.blendedPerM <= opts.priceCeilingPerM &&
      (c.contextLength ?? 0) >= opts.minContext &&
      (!opts.openWeightsOnly || c.openWeights),
  );
  if (!eligible.length) return { ranked: [], winner: null, poolSize: 0 };

  // 3. Capability band — absolute agentic-index gate.
  const pool = eligible.filter((c) => c.agenticIndex! >= floor);
  if (!pool.length) return { ranked: [], winner: null, poolSize: 0 };

  // 4. Hybrid score over the banded pool (min-max normalised).
  const q = pool.map((c) => c.agenticIndex!);
  const p = pool.map((c) => Math.log(c.blendedPerM!));
  const tVals = pool.filter((c) => c.throughput != null).map((c) => Math.log(Math.max(0.1, c.throughput!)));
  const [qMin, qMax] = [Math.min(...q), Math.max(...q)];
  const [pMin, pMax] = [Math.min(...p), Math.max(...p)];
  const [tMin, tMax] = tVals.length ? [Math.min(...tVals), Math.max(...tVals)] : [0, 0];
  const norm = (v: number, min: number, max: number) => (max > min ? (v - min) / (max - min) : 0.5);

  const wq = Math.max(0, opts.weights.quality);
  const wp = Math.min(PRICE_WEIGHT_CAP, Math.max(0, opts.weights.price)); // hard cap
  const wt = Math.max(0, opts.weights.speed);
  const wSum = wq + wp + wt || 1;
  const k = opts.successBiasK;

  const ranked: ScoredCandidate[] = pool.map((c) => {
    const qn = norm(c.agenticIndex!, qMin, qMax);
    const pn = 1 - norm(Math.log(c.blendedPerM!), pMin, pMax); // cheaper → 1
    const tn = c.throughput != null ? norm(Math.log(Math.max(0.1, c.throughput)), tMin, tMax) : 0.5;
    const hybridScore = (wq * qn + wp * pn + wt * tn) / wSum;
    const { rate, samples } = opts.successFor(c.id);
    const effRate = rate ?? NEUTRAL_PRIOR;
    const openBonus = c.openWeights ? 1 + Math.max(0, opts.openWeightBonus) : 1;
    const finalScore = hybridScore * (1 - k + 2 * k * effRate) * openBonus;
    return { ...c, hybridScore, successRate: rate, successSamples: samples, finalScore };
  });
  ranked.sort((a, b) => b.finalScore - a.finalScore || (b.agenticIndex ?? 0) - (a.agenticIndex ?? 0));
  return { ranked, winner: ranked[0] ?? null, poolSize: pool.length };
}
