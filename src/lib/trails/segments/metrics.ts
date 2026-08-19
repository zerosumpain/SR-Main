// What an effort on a segment actually cost you.
//
// Four reads, deliberately: time, speed, heart rate, and pace-against-heart-
// rate. The last is the one that answers "am I getting fitter" rather than
// "was I trying harder today", and it is given in both directions —
//
//   efficiency factor  metres per minute per beat   (higher is better)
//   beats per km       heartbeats spent per km      (lower is better)
//
// EF is not invented here: it is the same `efficiencyFactor` the activity
// pages and the physio dashboard already show, so a segment number and a
// whole-workout number are comparable and carry the same citation.

import { efficiencyFactor } from '$lib/health/analytics/efficiency';
import { MAX_INTERVAL_S, type HrSample } from '$lib/health/analytics/series-intervals';

export interface HeartrateWindow {
  avgBpm: number;
  maxBpm: number;
  /** Seconds of the window an actual sample accounts for. */
  coveredS: number;
}

/**
 * Fraction of an effort the heart-rate series must actually cover before an
 * average is claimed for it. Below this the watch lost contact, or the series
 * starts late, and a mean of what survived is not the mean of the effort.
 */
export const MIN_HR_COVERAGE = 0.5;

/**
 * Time-weighted heart rate over one window of an activity.
 *
 * Each sample is charged for the interval until the next one, clamped at
 * MAX_INTERVAL_S — the same step integration TRIMP and time-in-zone use, so a
 * dropout is never charged at the last-seen rate. Intervals are clipped to the
 * window rather than assigned to it whole, so an effort that starts mid-sample
 * is not credited with heartbeats from before it began.
 */
export function windowHeartrate(
  samples: HrSample[] | null | undefined,
  from: number,
  to: number,
): HeartrateWindow | null {
  if (!samples?.length || !(to > from)) return null;
  const sorted = [...samples].sort((a, b) => a[0] - b[0]);

  let weighted = 0;
  let coveredS = 0;
  let maxBpm = 0;

  // Intervals BETWEEN samples only, exactly as eachInterval does. Charging the
  // final sample forward would credit a series that stops 60 s into a five
  // minute effort with the whole effort at its last-seen rate — which is the
  // dropout this clamp exists to prevent, arriving by the back door.
  for (let i = 0; i < sorted.length - 1; i++) {
    const [t, bpm] = sorted[i];
    if (!Number.isFinite(bpm) || bpm <= 0) continue;
    const end = Math.min(sorted[i + 1][0], t + MAX_INTERVAL_S);

    const lo = Math.max(t, from);
    const hi = Math.min(end, to);
    if (hi <= lo) continue;

    weighted += bpm * (hi - lo);
    coveredS += hi - lo;
    if (bpm > maxBpm) maxBpm = bpm;
  }

  if (coveredS <= 0) return null;
  return { avgBpm: weighted / coveredS, maxBpm, coveredS };
}

export interface EffortMetricsInput {
  startS: number;
  endS: number;
  distanceM: number;
  hrSamples?: HrSample[] | null;
}

export interface EffortMetrics {
  durationS: number;
  speedMps: number;
  paceSPerKm: number;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  efficiencyFactor: number | null;
  beatsPerKm: number | null;
}

/** Heartbeats spent covering a kilometre. The price tag on a stretch. */
export function beatsPerKm(
  distanceM: number,
  durationS: number,
  avgBpm: number | null,
): number | null {
  if (!avgBpm || !(distanceM > 0) || !(durationS > 0)) return null;
  const beats = avgBpm * (durationS / 60);
  return Math.round((beats / (distanceM / 1000)) * 10) / 10;
}

export function effortMetrics(input: EffortMetricsInput): EffortMetrics | null {
  const durationS = input.endS - input.startS;
  if (!(durationS > 0) || !(input.distanceM > 0)) return null;

  const hr = windowHeartrate(input.hrSamples, input.startS, input.endS);
  const covered = hr && hr.coveredS / durationS >= MIN_HR_COVERAGE ? hr : null;
  const avgHeartrate = covered ? Math.round(covered.avgBpm * 10) / 10 : null;

  return {
    durationS: Math.round(durationS * 10) / 10,
    speedMps: Math.round((input.distanceM / durationS) * 1000) / 1000,
    paceSPerKm: Math.round(((durationS / input.distanceM) * 1000) * 10) / 10,
    avgHeartrate,
    maxHeartrate: covered ? Math.round(covered.maxBpm) : null,
    efficiencyFactor: efficiencyFactor(input.distanceM, durationS, avgHeartrate),
    beatsPerKm: beatsPerKm(input.distanceM, durationS, avgHeartrate),
  };
}

export type RankKey = 'durationS' | 'speedMps' | 'avgHeartrate' | 'efficiencyFactor' | 'beatsPerKm';

/** Which way is "best" for each metric. Getting this backwards on one column
 *  would quietly crown the worst effort, so it lives in one place. */
export const BEST_DIRECTION: Record<RankKey, 'asc' | 'desc'> = {
  durationS: 'asc',
  speedMps: 'desc',
  avgHeartrate: 'asc',
  efficiencyFactor: 'desc',
  beatsPerKm: 'asc',
};

/**
 * 1-based ranks per metric, nulls unranked.
 *
 * Ties share a rank — two identical efforts are both second, and neither is
 * third.
 */
export function rankEfforts<T>(rows: T[], key: RankKey, read: (row: T) => number | null): Map<T, number> {
  const scored = rows
    .map((row) => ({ row, value: read(row) }))
    .filter((r): r is { row: T; value: number } => r.value != null && Number.isFinite(r.value));

  scored.sort((a, b) =>
    BEST_DIRECTION[key] === 'asc' ? a.value - b.value : b.value - a.value,
  );

  const ranks = new Map<T, number>();
  let rank = 0;
  let previous: number | null = null;
  scored.forEach((entry, i) => {
    if (previous == null || entry.value !== previous) rank = i + 1;
    ranks.set(entry.row, rank);
    previous = entry.value;
  });
  return ranks;
}
