// src/lib/health/analytics/efficiency.ts
// Efficiency factor (EF) and aerobic decoupling — the two coaching-practice
// aerobic-fitness reads that need nothing but GPS + HR. EF = output per beat
// (metres/min ÷ bpm); rising EF at similar effort = improving aerobic economy.
// Decoupling compares first-half EF with second-half EF: a fit aerobic system
// holds pace-per-beat steady (< ~5% drift on steady work — Friel's heuristic;
// durability literature: Maunder 2021).

import type { HrSample } from './series-intervals';
import { haversineM } from '$lib/trails/track';

/**
 * Decoupling is only claimed for sustained steady work. The methodology entry
 * says "~40 minutes"; this constant is the single place that threshold lives.
 */
export const MIN_DECOUPLING_DURATION_S = 2400;

/** metres/min per bpm; null when either input can't support it. */
export function efficiencyFactor(
  distanceM: number | null | undefined,
  movingS: number | null | undefined,
  avgHr: number | null | undefined,
): number | null {
  if (!distanceM || !movingS || !avgHr || movingS <= 0 || avgHr <= 0) return null;
  const ef = distanceM / (movingS / 60) / avgHr;
  return Math.round(ef * 1000) / 1000;
}

export interface HalfStats {
  distanceM: number;
  durationS: number;
  avgHr: number;
}

/**
 * Split a workout into time halves using the GPS track (for distance) and the
 * HR series (for per-half average HR). Track points are the activity_tracks
 * shape: [lng, lat, elevation | null, secondsFromStart].
 */
export function splitHalves(
  coords: Array<[number, number, number | null, number]>,
  hrSamples: HrSample[],
): { first: HalfStats; second: HalfStats } | null {
  if (coords.length < 4 || hrSamples.length < 4) return null;
  // GPS lock can arrive well after the workout starts, so the track's span is
  // [t0, tEnd], not [0, tEnd]. Halving from 0 would charge the first half a
  // duration it has no distance for and skew decoupling negative.
  const t0 = coords[0][3];
  const tEnd = coords[coords.length - 1][3];
  if (tEnd <= t0) return null;
  const tMid = t0 + (tEnd - t0) / 2;

  let dFirst = 0;
  let dSecond = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineM(
      [coords[i - 1][0], coords[i - 1][1]],
      [coords[i][0], coords[i][1]],
    );
    if (coords[i][3] <= tMid) dFirst += d;
    else dSecond += d;
  }

  const firstHr = hrSamples.filter(([t]) => t <= tMid).map(([, hr]) => hr);
  const secondHr = hrSamples.filter(([t]) => t > tMid).map(([, hr]) => hr);
  if (firstHr.length < 2 || secondHr.length < 2) return null;

  return {
    first: { distanceM: dFirst, durationS: tMid - t0, avgHr: mean(firstHr) },
    second: { distanceM: dSecond, durationS: tEnd - tMid, avgHr: mean(secondHr) },
  };
}

/**
 * Aerobic decoupling in percent: positive = second half needed more beats per
 * metre (drift), negative = negative split on effort. Null when either half
 * can't produce an EF.
 */
export function decoupling(halves: { first: HalfStats; second: HalfStats } | null): number | null {
  if (!halves) return null;
  const ef1 = efficiencyFactor(halves.first.distanceM, halves.first.durationS, halves.first.avgHr);
  const ef2 = efficiencyFactor(
    halves.second.distanceM,
    halves.second.durationS,
    halves.second.avgHr,
  );
  if (!ef1 || !ef2) return null;
  return Math.round(((ef1 - ef2) / ef1) * 1000) / 10;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
