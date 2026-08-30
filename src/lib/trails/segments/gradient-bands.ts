// How much of a segment is actually steep.
//
// `SegmentDetail` stores ONE average gradient — net rise over run — which says
// nothing about shape. A 1.8 km stretch at an average 5.8% is a different piece
// of ground depending on whether it is 5.8% throughout or a 12% wall followed
// by a flat. The stored coordinates carry elevation, so the breakdown is
// derivable without a schema change (spec decision 3, 2026-08-30).
//
// Two decisions worth knowing:
//
//  1. BANDS ARE BY STEEPNESS, NOT BY SIGN. The strip answers "how steep is this
//     ground", so a 6% descent lands in the same band as a 6% climb. The net
//     direction is already on the page as `gradientPct`, which reads negative
//     for a descent.
//  2. GRADIENT IS MEASURED OVER A CHORD, NOT BETWEEN ADJACENT POINTS. Barometric
//     and GPS altitude both jitter by a metre at rest; over a 10 m step that is
//     a 10% gradient out of nothing. The chord is 50 m, the same order as the
//     1 m threshold `spanElevation` uses for the same reason.
//
// Pure and deterministic over its input, same contract as resample.ts — no
// database, no clock.

import { resampleTrack, spanDistanceM, STEP_M, type ResampledTrack } from './resample';
import type { TrackPoint } from '../track';

/** Lower edges, in percent. The last band is open-ended. */
export const GRADIENT_BAND_EDGES = [0, 4, 8, 12] as const;
export const GRADIENT_BAND_LABELS = ['0–4%', '4–8%', '8–12%', '12%+'] as const;

/** Chord the gradient is measured over. Shorter reads GPS noise as a wall. */
export const GRADIENT_CHORD_M = 50;

/**
 * Below this share of the path carrying an altitude, no breakdown is claimed.
 * The same half-coverage floor `MIN_HR_COVERAGE` applies to heart rate, and for
 * the same reason: a number measured over a fifth of the ground is not a
 * property of the ground.
 */
export const MIN_ELEVATION_COVERAGE = 0.5;

export interface GradientBand {
  /** Inclusive lower edge, percent. */
  fromPct: number;
  /** Exclusive upper edge, percent. Null on the open-ended top band. */
  toPct: number | null;
  label: string;
  distanceM: number;
  /** Whole percent. The four shares sum to exactly 100 when usable. */
  sharePct: number;
}

export interface GradientBands {
  bands: GradientBand[];
  /** Path length the bands were measured over — excludes any gap with no altitude. */
  measuredM: number;
  /** Fraction of the resampled path that carried an altitude, 0–1. */
  coverage: number;
  /** Steepest chord gradient on the segment, percent, unsigned. */
  steepestPct: number;
  usable: boolean;
}

function emptyBands(): GradientBand[] {
  return GRADIENT_BAND_EDGES.map((fromPct, k) => ({
    fromPct,
    toPct: k === GRADIENT_BAND_EDGES.length - 1 ? null : GRADIENT_BAND_EDGES[k + 1],
    label: GRADIENT_BAND_LABELS[k],
    distanceM: 0,
    sharePct: 0,
  }));
}

/** The fully-populated zero this returns when the ground cannot be read. */
export const GRADIENT_BANDS_ZERO: GradientBands = {
  bands: emptyBands(),
  measuredM: 0,
  coverage: 0,
  steepestPct: 0,
  usable: false,
};

export function gradientBands(
  coordinates: Array<[number, number, number | null, number]> | null | undefined,
  opts: { chordM?: number } = {},
): GradientBands {
  if (!coordinates || coordinates.length < 3) return GRADIENT_BANDS_ZERO;

  const track = resampleTrack(coordinates as TrackPoint[], STEP_M);
  if (track.n < 3 || track.sourceDistanceM <= 0) return GRADIENT_BANDS_ZERO;

  const half = Math.max(1, Math.round((opts.chordM ?? GRADIENT_CHORD_M) / 2 / STEP_M));
  const bands = emptyBands();
  let measuredM = 0;
  let steepestPct = 0;

  for (let i = 1; i < track.n; i++) {
    const stepM = spanDistanceM(track, i - 1, i);
    if (!(stepM > 0)) continue;
    const pct = chordGradientPct(track, i, half);
    // No altitude either side of this step: it is length the breakdown cannot
    // speak for, and it is left out rather than filed as flat.
    if (pct == null) continue;
    measuredM += stepM;
    steepestPct = Math.max(steepestPct, pct);
    bands[bandIndex(pct)].distanceM += stepM;
  }

  const coverage = measuredM / track.sourceDistanceM;
  if (measuredM <= 0 || coverage < MIN_ELEVATION_COVERAGE) {
    return { ...GRADIENT_BANDS_ZERO, coverage };
  }

  return {
    bands: withShares(bands, measuredM),
    measuredM,
    coverage,
    steepestPct: Math.round(steepestPct * 10) / 10,
    usable: true,
  };
}

/**
 * Gradient at step `i`, measured over a chord centred on it. Returns null when
 * either end of the chord has no altitude — the resampler writes NaN there,
 * never 0, because 0 is a real altitude.
 */
function chordGradientPct(track: ResampledTrack, i: number, half: number): number | null {
  const a = Math.max(0, i - half);
  const b = Math.min(track.n - 1, i + half);
  if (b <= a) return null;
  const eleA = track.ele[a];
  const eleB = track.ele[b];
  if (Number.isNaN(eleA) || Number.isNaN(eleB)) return null;
  const run = spanDistanceM(track, a, b);
  if (!(run > 0)) return null;
  return Math.abs((eleB - eleA) / run) * 100;
}

function bandIndex(pct: number): number {
  for (let k = GRADIENT_BAND_EDGES.length - 1; k >= 0; k--) {
    if (pct >= GRADIENT_BAND_EDGES[k]) return k;
  }
  return 0;
}

/**
 * Whole-percent shares that sum to exactly 100.
 *
 * Rounding each share independently leaves the strip at 99% or 101%, and the
 * design lays the bar out in `fr` columns off these numbers — so the remainder
 * goes to the bands with the largest fractional parts, largest first.
 */
function withShares(bands: GradientBand[], totalM: number): GradientBand[] {
  const exact = bands.map((b) => (b.distanceM / totalM) * 100);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, k) => ({ k, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const shares = [...floors];
  for (const { k } of order) {
    if (remainder <= 0) break;
    shares[k] += 1;
    remainder--;
  }
  return bands.map((b, k) => ({ ...b, sharePct: shares[k] }));
}
