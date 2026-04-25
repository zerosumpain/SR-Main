// src/lib/health/analytics/monotony.ts
import type { MetricResult } from './types';

export type MonotonyResult = {
  monotony: number;     // mean / SD (capped at 100)
  strain: number;       // sum * monotony
  mean: number;
  sd: number;
  band: 'low' | 'moderate' | 'high';
};

const MONOTONY_CAP = 100;

export function computeMonotony(daily: number[]): MetricResult<MonotonyResult> {
  if (daily.length < 7) {
    return {
      value: { monotony: 0, strain: 0, mean: 0, sd: 0, band: 'low' },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: daily.length,
    };
  }
  const window = daily.slice(-7);
  const sum = window.reduce((a, b) => a + b, 0);
  const mean = sum / window.length;
  const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
  const sd = Math.sqrt(variance);
  const rawMonotony = sd === 0 ? MONOTONY_CAP : mean / sd;
  const monotony = Math.min(rawMonotony, MONOTONY_CAP);
  const strain = sum * monotony;
  const band: MonotonyResult['band'] =
    monotony > 2 ? 'high' : monotony > 1 ? 'moderate' : 'low';
  return {
    value: { monotony, strain, mean, sd, band },
    sufficiency: 'ok',
    asOf: new Date().toISOString(),
    sampleSize: window.length,
  };
}
