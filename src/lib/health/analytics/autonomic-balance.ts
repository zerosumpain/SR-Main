// src/lib/health/analytics/autonomic-balance.ts
import type { MetricResult } from './types';

export type AutonomicSample = { date: string; hrv: number; rhr: number };

export type AutonomicResult = {
  score: number;             // 0–100
  hrvZ: number;
  rhrZ: number;
  hrv7dMean: number;
  rhr7dMean: number;
  hrvBaselineMean: number;
  rhrBaselineMean: number;
};

export function computeAutonomicBalance(series: AutonomicSample[]): MetricResult<AutonomicResult> {
  if (series.length < 14) {
    return {
      value: { score: 0, hrvZ: 0, rhrZ: 0, hrv7dMean: 0, rhr7dMean: 0, hrvBaselineMean: 0, rhrBaselineMean: 0 },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: series.length,
    };
  }
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-7);
  const baseline = sorted.slice(0, sorted.length - 7);

  const hrv7d = mean(recent.map((s) => s.hrv));
  const rhr7d = mean(recent.map((s) => s.rhr));
  const hrvBase = mean(baseline.map((s) => s.hrv));
  const rhrBase = mean(baseline.map((s) => s.rhr));
  const hrvSD = stdev(baseline.map((s) => s.hrv));
  const rhrSD = stdev(baseline.map((s) => s.rhr));

  // When baseline SD is 0 (constant baseline), the standard z-score is undefined.
  // Fall back to a percentage-difference unit: 1 "z-unit" ≈ 25% relative change.
  // This keeps the score sensible when the baseline has no variance (e.g. synthetic
  // data or a very stable metric) while preserving z-score semantics otherwise.
  const hrvZ = hrvSD === 0
    ? (hrv7d - hrvBase) / Math.max(1, hrvBase) * 4
    : (hrv7d - hrvBase) / hrvSD;     // higher = better

  const rhrZ = rhrSD === 0
    ? (rhr7d - rhrBase) / Math.max(1, rhrBase) * 4
    : (rhr7d - rhrBase) / rhrSD;     // higher = WORSE

  const composite = hrvZ - rhrZ;     // higher = better autonomic balance
  // Map composite z (typically −2..+2) to 0..100, clipped.
  const score = Math.max(0, Math.min(100, 50 + composite * 25));

  return {
    value: {
      score,
      hrvZ,
      rhrZ,
      hrv7dMean: hrv7d,
      rhr7dMean: rhr7d,
      hrvBaselineMean: hrvBase,
      rhrBaselineMean: rhrBase,
    },
    sufficiency: sorted.length >= 28 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: sorted.length,
  };
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
