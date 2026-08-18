// tests/lib/health/analytics/rolling.test.ts
import { describe, it, expect } from 'vitest';
import { rollingMean, trailingMean } from '$lib/health/analytics/rolling';

const day = (n: number) => `2026-03-${String(n).padStart(2, '0')}`;

describe('rollingMean', () => {
  it('averages over calendar days, not array entries', () => {
    // Readings on days 1..4 then a gap to day 10. A 7-day window at day 10
    // must only see day 10 (days 4..10 hold one reading) — below minCount.
    const series = [1, 2, 3, 4].map((n) => ({ date: day(n), value: n * 10 }));
    series.push({ date: day(10), value: 100 });
    const out = rollingMean(series, 7, 3);
    expect(out.map((p) => p.date)).toEqual([day(3), day(4)]);
    expect(out[1].value).toBeCloseTo(25); // mean of 10,20,30,40
  });

  it('returns empty for a series thinner than minCount everywhere', () => {
    expect(rollingMean([{ date: day(1), value: 5 }], 7, 3)).toEqual([]);
  });
});

describe('trailingMean', () => {
  it('means the readings inside the trailing window only', () => {
    const series = [
      { date: day(1), value: 100 },
      { date: day(20), value: 50 },
      { date: day(21), value: 60 },
    ];
    expect(trailingMean(series, 7)).toBeCloseTo(55);
  });

  it('returns null on empty input', () => {
    expect(trailingMean([], 7)).toBeNull();
  });
});
