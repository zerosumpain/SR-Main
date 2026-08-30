// tests/lib/health/analytics/acwr.test.ts
import { describe, it, expect } from 'vitest';
import { computeACWR, acwrSeries, preferredACWR } from '$lib/health/analytics/acwr';
import type { MetricResult } from '$lib/health/analytics/types';
import type { ACWRResult } from '$lib/health/analytics/acwr';

describe('computeACWR', () => {
  it('returns ratio ~1 for steady load', () => {
    const days = Array.from({ length: 28 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      load: 10,
    }));
    const r = computeACWR(days);
    expect(r.value.ratio).toBeGreaterThan(0.95);
    expect(r.value.ratio).toBeLessThan(1.05);
    expect(r.value.zone).toBe('optimal');
  });

  it('classifies sudden spike as caution or danger', () => {
    const baseline = Array.from({ length: 21 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`, load: 5,
    }));
    const spike = Array.from({ length: 7 }).map((_, i) => ({
      date: `2026-01-${String(i + 22).padStart(2, '0')}`, load: 25,
    }));
    const r = computeACWR([...baseline, ...spike]);
    expect(['caution', 'danger']).toContain(r.value.zone);
  });

  it('reports insufficient with < 14 days', () => {
    const r = computeACWR([{ date: '2026-01-01', load: 5 }]);
    expect(r.sufficiency).toBe('insufficient');
  });
});

describe('acwrSeries', () => {
  const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

  it('omits the days before the 14-day floor rather than zero-filling them', () => {
    const days = Array.from({ length: 20 }, (_, i) => ({ date: day(i), load: 10 }));
    const series = acwrSeries(days);
    expect(series).toHaveLength(7);
    expect(series[0].date).toBe(day(13));
  });

  it('agrees with computeACWR on the last day, which is the number the page shows', () => {
    const days = Array.from({ length: 40 }, (_, i) => ({ date: day(i), load: 5 + (i % 4) * 6 }));
    const series = acwrSeries(days);
    const point = computeACWR(days);
    expect(series[series.length - 1].value).toBeCloseTo(point.value.ratio, 2);
  });

  it('returns nothing for an empty load history', () => {
    expect(acwrSeries([])).toEqual([]);
  });
});

describe('preferredACWR — which ratio the page shows', () => {
  const ZERO: ACWRResult = { acuteEWMA: 0, chronicEWMA: 0, ratio: 0, zone: 'detraining' };
  const result = (
    ratio: number,
    sufficiency: MetricResult<ACWRResult>['sufficiency'],
    sampleSize: number,
  ): MetricResult<ACWRResult> => ({
    value: ratio === 0 ? ZERO : { acuteEWMA: ratio * 10, chronicEWMA: 10, ratio, zone: 'optimal' },
    sufficiency,
    asOf: '2026-08-30',
    sampleSize,
  });

  it('leads on TRIMP when TRIMP is readable', () => {
    const trimp = result(1.05, 'ok', 40);
    const strain = result(0.9, 'ok', 40);
    expect(preferredACWR(trimp, strain)).toBe(trimp);
  });

  it('falls back to strain while the TRIMP history is still filling', () => {
    // The bug this closes: `computeACWR` hands back a fully populated ZERO
    // struct under fourteen load days, and physio-service builds a TRIMP result
    // from ONE. `trimp ?? strain` therefore preferred a confident 0.00
    // "detraining" for the whole of the fill-in period the fallback exists for.
    const trimp = result(0, 'insufficient', 6);
    const strain = result(1.12, 'ok', 40);
    expect(preferredACWR(trimp, strain)).toBe(strain);
  });

  it('takes a PARTIAL TRIMP read over strain — partial is still a real ratio', () => {
    const trimp = result(0.94, 'partial', 20);
    expect(preferredACWR(trimp, result(1.12, 'ok', 40))).toBe(trimp);
  });

  it('keeps the insufficient TRIMP result when strain is missing or thin', () => {
    const trimp = result(0, 'insufficient', 6);
    expect(preferredACWR(trimp, null)).toBe(trimp);
    expect(preferredACWR(trimp, result(0, 'insufficient', 3))).toBe(trimp);
  });

  it('reaches for strain when there is no TRIMP result at all, and null for neither', () => {
    const strain = result(1.12, 'ok', 40);
    expect(preferredACWR(null, strain)).toBe(strain);
    expect(preferredACWR(null, null)).toBeNull();
    expect(preferredACWR(undefined, undefined)).toBeNull();
  });
});
