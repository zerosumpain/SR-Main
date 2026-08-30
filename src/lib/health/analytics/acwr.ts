// src/lib/health/analytics/acwr.ts
// EWMA-based Acute:Chronic Workload Ratio (Williams et al. 2017)
import type { MetricResult } from './types';

export type LoadDay = { date: string; load: number };
export type ACWRZone = 'detraining' | 'undertraining' | 'optimal' | 'caution' | 'danger';

export type ACWRResult = {
  acuteEWMA: number;
  chronicEWMA: number;
  ratio: number;
  zone: ACWRZone;
};

/**
 * The band edges, named once. Read them rather than repeating the numbers:
 * the tripwire table and the coach both quote "below 0.5 is detraining", and a
 * threshold that lives in three files eventually means three things.
 */
export const ACWR_BANDS = {
  /** Below this, the base is going backwards. */
  detraining: 0.5,
  /** Below this, there is room to add — the planner reads it as licence. */
  undertraining: 0.8,
  /** Up to this, fitness builds without breaking. */
  optimal: 1.3,
  /** Above this is the band injuries come from. */
  caution: 1.5,
} as const;

export function computeACWR(days: LoadDay[]): MetricResult<ACWRResult> {
  if (days.length < 14) {
    return {
      value: { acuteEWMA: 0, chronicEWMA: 0, ratio: 0, zone: 'detraining' },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: days.length,
    };
  }
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const loads = sorted.map((d) => d.load);
  const acute = ewma(loads, 7);
  const chronic = ewma(loads, 28);
  const ratio = chronic === 0 ? 0 : acute / chronic;
  const zone: ACWRZone =
    ratio < ACWR_BANDS.detraining ? 'detraining' :
    ratio < ACWR_BANDS.undertraining ? 'undertraining' :
    ratio <= ACWR_BANDS.optimal ? 'optimal' :
    ratio <= ACWR_BANDS.caution ? 'caution' : 'danger';
  return {
    value: { acuteEWMA: acute, chronicEWMA: chronic, ratio, zone },
    sufficiency: sorted.length >= 28 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: sorted.length,
  };
}

/**
 * Exponentially weighted moving average.
 * lambda = 1 - exp(ln(0.5) / halfLifeDays) gives the weight assigned
 * to the current observation (half-life in days).
 */
function ewma(values: number[], halfLifeDays: number): number {
  if (values.length === 0) return 0;
  const lambda = 1 - Math.exp(Math.log(0.5) / halfLifeDays);
  let s = values[0];
  for (let i = 1; i < values.length; i++) {
    s = lambda * values[i] + (1 - lambda) * s;
  }
  return s;
}
