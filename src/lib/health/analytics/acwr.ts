// src/lib/health/analytics/acwr.ts
// EWMA-based Acute:Chronic Workload Ratio (Williams et al. 2017)
import type { MetricResult } from './types';
import type { DayPoint } from './rolling';

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
 * Which of the two ratios to show, when both exist.
 *
 * The TRIMP-based ratio is the honest one and the Whoop-strain ratio is the
 * interim while the load history fills — but `computeACWR` returns a fully
 * populated ZERO struct with `sufficiency: 'insufficient'` under fourteen days,
 * and the physio service builds a TRIMP result the moment there is ONE load
 * day. A plain `trimp ?? strain` therefore picks a confident 0.00 "detraining"
 * over a perfectly readable strain ratio for the whole of the fill-in period the
 * fallback exists to cover. Preference, then, is on USABILITY first.
 */
export function preferredACWR(
  trimp: MetricResult<ACWRResult> | null | undefined,
  strain: MetricResult<ACWRResult> | null | undefined,
): MetricResult<ACWRResult> | null {
  if (trimp && trimp.sufficiency !== 'insufficient') return trimp;
  if (strain && strain.sufficiency !== 'insufficient') return strain;
  // Neither is readable. Still hand back the TRIMP one when it exists so the
  // panels that print "needs fourteen days" get a sample size to quote.
  return trimp ?? strain ?? null;
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

/**
 * The ratio as it stood on each day — the series a trend line or a forecast
 * needs, which `computeACWR` cannot give because it answers for one day only.
 *
 * The two EWMAs are carried forward rather than recomputed per prefix. They are
 * recursive, so the carried value at day i is exactly what a full recompute
 * over days 0..i would produce; this is the same number in O(n).
 *
 * Days before the 14-day floor are omitted, not zero-filled: `computeACWR`
 * refuses to report a ratio there and a chart must not draw one either.
 */
export function acwrSeries(days: LoadDay[], minDays = 14): DayPoint[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return [];
  const acuteLambda = 1 - Math.exp(Math.log(0.5) / 7);
  const chronicLambda = 1 - Math.exp(Math.log(0.5) / 28);
  let acute = sorted[0].load;
  let chronic = sorted[0].load;
  const out: DayPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      acute = acuteLambda * sorted[i].load + (1 - acuteLambda) * acute;
      chronic = chronicLambda * sorted[i].load + (1 - chronicLambda) * chronic;
    }
    if (i + 1 < minDays) continue;
    const ratio = chronic === 0 ? 0 : acute / chronic;
    out.push({ date: sorted[i].date, value: Math.round(ratio * 1000) / 1000 });
  }
  return out;
}
