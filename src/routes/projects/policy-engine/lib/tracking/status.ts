// tracking/status.ts — classify reality vs a projected trajectory for one indicator.
// "on-track" means reality is at least as good as the model expected, within an
// uncertainty band; "off-track" means it fell worse than the band/tolerance allows.

import type { TrackStatus } from './types';

export interface ClassifyOpts {
  /** Higher is better? (attainment true; absence/gaps/NEET/poverty false) */
  goodIfUp: boolean;
  /** Explicit uncertainty band (e.g. the Monte-Carlo P10–P90 fan). Wins over tolerancePct. */
  band?: { lo: number; hi: number };
  /** Relative tolerance around the projection, in percent (default 3%). */
  tolerancePct?: number;
}

export function classifyStatus(
  observed: number | null | undefined,
  projected: number | null | undefined,
  opts: ClassifyOpts,
): TrackStatus {
  if (observed == null || projected == null || !Number.isFinite(observed) || !Number.isFinite(projected)) {
    return 'no-data';
  }
  const better = opts.goodIfUp ? observed > projected : observed < projected;
  if (better) return 'on-track'; // beating the plan is always on-track

  if (opts.band) {
    const inside = observed >= opts.band.lo && observed <= opts.band.hi;
    return inside ? 'on-track' : 'off-track';
  }

  const tol = ((opts.tolerancePct ?? 3) / 100) * Math.abs(projected);
  const worseBy = Math.abs(observed - projected);
  return worseBy <= tol ? 'on-track' : 'off-track';
}
