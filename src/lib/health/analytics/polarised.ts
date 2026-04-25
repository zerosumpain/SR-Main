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
    midPct > 50 ? 'junk-middle' :
    easyPct >= 80 && hardPct >= 10 ? 'polarised' :
    easyPct >= 70 && midPct >= 15 ? 'pyramid' :
    'pyramid';
  return {
    value: { easyPct, midPct, hardPct, verdict, totalMinutes: total / 60_000 },
    sufficiency: 'ok',
    asOf: new Date().toISOString(),
    sampleSize: workouts.length,
  };
}
