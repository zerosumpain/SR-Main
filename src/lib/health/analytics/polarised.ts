import type { MetricResult } from './types';

export type ZoneDurations = {
  z0: number; z1: number; z2: number; z3: number; z4: number; z5: number;
};

export type PolarisedResult = {
  easyPct: number;        // Z1+Z2 (Z0 excluded — recovery noise)
  midPct: number;         // Z3
  hardPct: number;        // Z4+Z5
  verdict: 'polarised' | 'pyramid' | 'junk-middle' | 'insufficient-volume';
  totalMinutes: number;
};

/**
 * What "polarised" costs: at least this share of the time easy, AND at least
 * this share genuinely hard. Named because the verdict, the moves list and the
 * experiment that chases it all have to mean the same two numbers.
 */
export const POLARISED_EASY_PCT = 80;
export const POLARISED_HARD_PCT = 10;
/** Over this share in Z3 is the junk middle — the real trap. */
export const JUNK_MIDDLE_PCT = 50;

export function computePolarised(workouts: ZoneDurations[]): MetricResult<PolarisedResult> {
  if (workouts.length === 0) {
    return {
      value: { easyPct: 0, midPct: 0, hardPct: 0, verdict: 'insufficient-volume', totalMinutes: 0 },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: 0,
    };
  }
  let easy = 0, mid = 0, hard = 0;
  for (const w of workouts) {
    easy += w.z1 + w.z2;
    mid += w.z3;
    hard += w.z4 + w.z5;
  }
  const total = easy + mid + hard;
  if (total === 0) {
    return {
      value: { easyPct: 0, midPct: 0, hardPct: 0, verdict: 'insufficient-volume', totalMinutes: 0 },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: workouts.length,
    };
  }
  const easyPct = (easy / total) * 100;
  const midPct = (mid / total) * 100;
  const hardPct = (hard / total) * 100;
  const verdict: PolarisedResult['verdict'] =
    midPct > JUNK_MIDDLE_PCT ? 'junk-middle' :
    easyPct >= POLARISED_EASY_PCT && hardPct >= POLARISED_HARD_PCT ? 'polarised' :
    easyPct >= 70 && midPct >= 15 ? 'pyramid' :
    'pyramid';
  return {
    value: { easyPct, midPct, hardPct, verdict, totalMinutes: total / 60_000 },
    sufficiency: 'ok',
    asOf: new Date().toISOString(),
    sampleSize: workouts.length,
  };
}
