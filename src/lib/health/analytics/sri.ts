// src/lib/health/analytics/sri.ts
import type { MetricResult } from './types';

export type SleepInterval = {
  startLocalIso: string;
  endLocalIso: string;
};

const MINUTES_PER_DAY = 24 * 60;

/**
 * The regularity of someone who goes to bed and gets up at the same time.
 * 0 is random, 100 is minute-identical nightly, and 85 is the practical
 * target — the number the sleep-window move is aiming at.
 */
export const SRI_TARGET = 85;

/**
 * Phillips 2017 Sleep Regularity Index.
 * For each minute m in [0, 1440), compute the fraction of pairs (i,j) where
 * day_i and day_j have the same sleep state at minute m. Average over all
 * minutes and pairs. Output 0–100.
 *
 * Each interval is assigned to its start-date bucket. Minutes past midnight
 * wrap modularly so a 23:00–07:00 sleep fills minutes 1380–1440 and 0–420
 * within the same 1440-slot day array.
 */
export function computeSRI(intervals: SleepInterval[]): MetricResult<number> {
  if (intervals.length < 7) {
    return { value: 0, sufficiency: 'insufficient', asOf: new Date().toISOString(), sampleSize: intervals.length };
  }

  // Build one day bucket per start-date. Minutes that cross midnight wrap
  // modularly within the same 1440-slot array so identical nightly patterns
  // produce identical arrays regardless of midnight-crossing.
  const days = new Map<string, Uint8Array>();
  for (const iv of intervals) {
    const start = new Date(iv.startLocalIso);
    const end = new Date(iv.endLocalIso);
    const dayKey = start.toISOString().slice(0, 10);
    let arr = days.get(dayKey);
    if (!arr) {
      arr = new Uint8Array(MINUTES_PER_DAY);
      days.set(dayKey, arr);
    }
    const dayStart = new Date(dayKey + 'T00:00:00Z').getTime();
    const durationMs = end.getTime() - start.getTime();
    const startMin = Math.floor((start.getTime() - dayStart) / 60000);
    const endMin = Math.ceil(startMin + durationMs / 60000);
    for (let m = startMin; m < endMin; m++) {
      arr[m % MINUTES_PER_DAY] = 1;
    }
  }

  const dayArrays = [...days.values()];
  if (dayArrays.length < 2) {
    return { value: 0, sufficiency: 'insufficient', asOf: new Date().toISOString(), sampleSize: intervals.length };
  }

  let agreement = 0;
  let pairs = 0;
  for (let i = 0; i < dayArrays.length; i++) {
    for (let j = i + 1; j < dayArrays.length; j++) {
      let same = 0;
      const a = dayArrays[i];
      const b = dayArrays[j];
      for (let m = 0; m < MINUTES_PER_DAY; m++) {
        if (a[m] === b[m]) same++;
      }
      agreement += same / MINUTES_PER_DAY;
      pairs++;
    }
  }
  const sri = (agreement / pairs) * 100;

  return {
    value: sri,
    sufficiency: dayArrays.length >= 14 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: dayArrays.length,
  };
}
