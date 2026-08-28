// Which other segments are worth comparing against this one.
//
// Two lenses, deliberately separate: ground that LOOKS the same (similar climb
// over a similar length — does my efficiency transfer to comparable hills?)
// and ground that COSTS the same (closest best efficiency factor — which
// stretches ask the same of me, whatever they look like on the map?).
//
// Pure functions over plain rows, like the matcher: the thresholds here are
// pinned by similarity.test.ts, and the caller decides what a candidate is
// (in practice: same activity type, from segments-service).

export interface SimilarityCandidate {
  id: number;
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  bestEfficiencyFactor: number | null;
}

export interface Scored<T> {
  row: T;
  /** Lower is more similar. Bounded by the MAX_* constant of its lens. */
  score: number;
}

/** Net rise over run, in percent. A descent reads negative. */
export function netGradientPct(seg: {
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
}): number {
  if (!(seg.distanceM > 0)) return 0;
  return ((seg.elevationGainM - seg.elevationLossM) / seg.distanceM) * 100;
}

/**
 * Similar-climb score budget. One point ≈ one percentage point of gradient
 * difference, or half a doubling of length. Within the budget you can trade
 * them: same gradient at 2× the length is as comparable as 2 pp steeper at
 * the same length. Beyond it the comparison stops meaning anything.
 */
export const MAX_CLIMB_SCORE = 4;

/** Best-EF window for "costs the same" — relative, so a walker's 0.8 and a
 *  runner's 1.8 get proportionate tolerances. */
export const MAX_EF_RELATIVE_DELTA = 0.1;

/**
 * Ground that looks like this ground: nearest in net gradient and length.
 *
 * A real climb (|gradient| ≥ 1%) never matches its own descent — opposite
 * signs are rejected outright. Near-level ground may match its own reverse
 * twin, deliberately: at under 1% either way it is the same flat ground, and
 * comparing efficiency across the two directions is legitimate.
 */
export function similarByClimb<T extends SimilarityCandidate>(
  ref: SimilarityCandidate,
  candidates: T[],
  limit = 5,
): Array<Scored<T>> {
  const refGrad = netGradientPct(ref);
  const out: Array<Scored<T>> = [];

  for (const candidate of candidates) {
    if (candidate.id === ref.id) continue;
    if (!(candidate.distanceM > 0) || !(ref.distanceM > 0)) continue;
    // Opposite signs on real slopes means one is the other's descent. Level
    // ground (gradient 0) is not "the other direction" — it competes on score.
    const grad = netGradientPct(candidate);
    if (Math.abs(refGrad) >= 1 && grad * refGrad < 0) continue;

    const gradientCost = Math.abs(grad - refGrad);
    const lengthCost = 2 * Math.abs(Math.log2(candidate.distanceM / ref.distanceM));
    const score = gradientCost + lengthCost;
    if (score <= MAX_CLIMB_SCORE) out.push({ row: candidate, score });
  }

  return out.sort((a, b) => a.score - b.score).slice(0, limit);
}

/**
 * Ground that costs like this ground: nearest best efficiency factor, within
 * MAX_EF_RELATIVE_DELTA of the reference. Both sides need a best EF — a
 * segment with no heart-rate history has no cost to compare.
 */
export function similarByEfficiency<T extends SimilarityCandidate>(
  ref: SimilarityCandidate,
  candidates: T[],
  limit = 5,
): Array<Scored<T>> {
  const refEf = ref.bestEfficiencyFactor;
  if (refEf == null || !(refEf > 0)) return [];

  const out: Array<Scored<T>> = [];
  for (const candidate of candidates) {
    if (candidate.id === ref.id) continue;
    const ef = candidate.bestEfficiencyFactor;
    if (ef == null || !(ef > 0)) continue;
    const score = Math.abs(ef - refEf) / refEf;
    if (score <= MAX_EF_RELATIVE_DELTA) out.push({ row: candidate, score });
  }

  return out.sort((a, b) => a.score - b.score).slice(0, limit);
}
