// src/lib/health/analytics/vo2max-percentile.ts
import type { MetricResult } from './types';

export type VO2Sample = { date: string; value: number };
export type Profile = { age: number; sex: 'male' | 'female' };

export type VO2Result = {
  current: number;
  trendSlopePerMonth: number;
  percentile: number;
  band: 'poor' | 'fair' | 'good' | 'excellent' | 'superior';
};

// ACSM 11th ed. percentile breakpoints (cardiorespiratory fitness, mL/kg/min).
// Columns: 20th, 40th, 60th, 80th, 95th. Rows: age bands.
const ACSM_MALE: Record<string, [number, number, number, number, number]> = {
  '20-29': [37.1, 41.0, 45.0, 49.0, 56.2],
  '30-39': [35.1, 38.9, 43.0, 47.0, 53.7],
  '40-49': [33.0, 36.7, 40.5, 44.5, 51.1],
  '50-59': [30.2, 33.8, 37.4, 41.0, 47.3],
  '60-69': [27.5, 30.6, 33.7, 36.7, 42.4],
  '70-79': [24.9, 27.5, 30.0, 32.5, 38.0],
};
const ACSM_FEMALE: Record<string, [number, number, number, number, number]> = {
  '20-29': [29.9, 33.0, 36.0, 39.5, 45.5],
  '30-39': [28.0, 31.0, 33.8, 37.0, 42.0],
  '40-49': [25.5, 28.0, 30.5, 33.5, 38.0],
  '50-59': [22.7, 25.0, 27.4, 30.0, 34.5],
  '60-69': [21.0, 23.0, 25.0, 27.0, 31.0],
  '70-79': [19.5, 21.0, 22.5, 24.5, 28.0],
};

const PERCENTILES = [20, 40, 60, 80, 95];

export function computeVO2MaxResult(series: VO2Sample[], profile: Profile): MetricResult<VO2Result> {
  if (series.length === 0) {
    return {
      value: { current: 0, trendSlopePerMonth: 0, percentile: 0, band: 'poor' },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: 0,
    };
  }
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const current = sorted[sorted.length - 1].value;
  const slope = linearSlopePerMonth(sorted);
  const breakpoints = lookupBreakpoints(profile);
  const percentile = percentileFromBreakpoints(current, breakpoints);
  const band: VO2Result['band'] =
    percentile >= 80 ? 'superior' :
    percentile >= 60 ? 'excellent' :
    percentile >= 40 ? 'good' :
    percentile >= 20 ? 'fair' : 'poor';

  return {
    value: { current, trendSlopePerMonth: slope, percentile, band },
    sufficiency: sorted.length >= 3 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: sorted.length,
  };
}

function lookupBreakpoints(p: Profile): [number, number, number, number, number] {
  const table = p.sex === 'male' ? ACSM_MALE : ACSM_FEMALE;
  const band =
    p.age < 30 ? '20-29' :
    p.age < 40 ? '30-39' :
    p.age < 50 ? '40-49' :
    p.age < 60 ? '50-59' :
    p.age < 70 ? '60-69' : '70-79';
  return table[band];
}

function percentileFromBreakpoints(v: number, bps: [number, number, number, number, number]): number {
  if (v < bps[0]) return Math.max(0, (v / bps[0]) * 20);
  for (let i = 0; i < bps.length - 1; i++) {
    if (v < bps[i + 1]) {
      const span = bps[i + 1] - bps[i];
      const within = span === 0 ? 0 : (v - bps[i]) / span;
      return PERCENTILES[i] + within * (PERCENTILES[i + 1] - PERCENTILES[i]);
    }
  }
  return 95 + Math.min(5, ((v - bps[4]) / Math.max(1, bps[4])) * 5);
}

function linearSlopePerMonth(series: VO2Sample[]): number {
  if (series.length < 2) return 0;
  const t0 = new Date(series[0].date).getTime();
  const xs = series.map((s) => (new Date(s.date).getTime() - t0) / (1000 * 60 * 60 * 24 * 30));
  const ys = series.map((s) => s.value);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
