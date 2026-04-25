// tests/lib/health/analytics/vo2max-percentile.test.ts
import { describe, it, expect } from 'vitest';
import { computeVO2MaxResult } from '$lib/health/analytics/vo2max-percentile';

describe('computeVO2MaxResult', () => {
  it('returns the latest value and trend slope', () => {
    const series = [
      { date: '2026-01-01', value: 40 },
      { date: '2026-02-01', value: 42 },
      { date: '2026-03-01', value: 44 },
    ];
    const r = computeVO2MaxResult(series, { age: 35, sex: 'male' });
    expect(r.value.current).toBe(44);
    expect(r.value.trendSlopePerMonth).toBeGreaterThan(0);
    expect(r.value.percentile).toBeGreaterThan(0);
    expect(r.sufficiency).toBe('ok');
  });

  it('reports insufficient with no data', () => {
    const r = computeVO2MaxResult([], { age: 35, sex: 'male' });
    expect(r.sufficiency).toBe('insufficient');
  });
});
