import { describe, it, expect } from 'vitest';
import {
  recencyWeight,
  recencyOf,
  ageInDays,
  decayWeight,
  withinRollingWindow,
  DEFAULT_HALF_LIFE_DAYS,
  RECENCY_FLOOR,
  ROLLING_WINDOW_DAYS,
  MS_PER_DAY,
} from '$lib/jkai/intel/staleness';

describe('recencyWeight', () => {
  it('is 1 for something observed right now', () => {
    expect(recencyWeight(0)).toBe(1);
  });

  it('halves at the half-life', () => {
    expect(recencyWeight(DEFAULT_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 5);
  });

  it('decays monotonically with age', () => {
    const series = [0, 7, 14, 28, 56, 84].map((d) => recencyWeight(d));
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeLessThanOrEqual(series[i - 1]);
    }
  });

  it('floors rather than reaching zero, so old evidence fades but survives', () => {
    expect(recencyWeight(10_000)).toBe(RECENCY_FLOOR);
    expect(recencyWeight(10_000)).toBeGreaterThan(0);
  });

  it('clamps future timestamps to 1 instead of scoring above everything current', () => {
    // Clock skew on a sending server produces genuinely future internalDates.
    expect(recencyWeight(-30)).toBe(1);
  });

  it('falls back to the floor for a non-finite age', () => {
    expect(recencyWeight(Number.NaN)).toBe(RECENCY_FLOOR);
    expect(recencyWeight(Number.POSITIVE_INFINITY)).toBe(RECENCY_FLOOR);
  });

  it('honours a custom half-life', () => {
    expect(recencyWeight(7, 7)).toBeCloseTo(0.5, 5);
    // A zero or negative half-life is nonsense; fall back rather than divide by it.
    expect(recencyWeight(DEFAULT_HALF_LIFE_DAYS, 0)).toBeCloseTo(0.5, 5);
  });

  it('still carries meaningful weight at the edge of the rolling window', () => {
    // The window is two half-lives, so ~25% — faded, not erased.
    expect(recencyWeight(ROLLING_WINDOW_DAYS)).toBeCloseTo(0.25, 2);
  });
});

describe('ageInDays', () => {
  const now = Date.UTC(2026, 7, 3);

  it('measures whole days back', () => {
    expect(ageInDays(now - 10 * MS_PER_DAY, now)).toBeCloseTo(10, 6);
  });

  it('reads a future instant as zero age, not negative', () => {
    expect(ageInDays(now + 5 * MS_PER_DAY, now)).toBe(0);
  });

  it('treats a missing or zero timestamp as infinitely old', () => {
    expect(ageInDays(0, now)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('recencyOf', () => {
  const now = Date.UTC(2026, 7, 3);

  it('scores a fresh timestamp at 1', () => {
    expect(recencyOf(now, now)).toBe(1);
  });

  it('scores null at the floor rather than throwing', () => {
    expect(recencyOf(null, now)).toBe(RECENCY_FLOOR);
    expect(recencyOf(undefined, now)).toBe(RECENCY_FLOOR);
  });

  it('agrees with recencyWeight for the same age', () => {
    expect(recencyOf(now - 21 * MS_PER_DAY, now)).toBeCloseTo(recencyWeight(21), 6);
  });
});

describe('decayWeight', () => {
  it('leaves a fresh edge untouched', () => {
    expect(decayWeight(0.8, 1)).toBeCloseTo(0.8, 6);
  });

  it('discounts a stale edge but only by the exposed share', () => {
    // pull 0.5 → at most half the weight is at risk from age.
    expect(decayWeight(0.8, 0)).toBeCloseTo(0.4, 6);
  });

  it('keeps a well-corroborated old edge above a single fresh mention', () => {
    // This is the whole reason decay is partial rather than multiplicative.
    const oldButCorroborated = decayWeight(0.95, RECENCY_FLOOR);
    const freshSingleMention = decayWeight(0.4, 1);
    expect(oldButCorroborated).toBeGreaterThan(freshSingleMention);
  });

  it('stays inside [0,1] for out-of-range input', () => {
    expect(decayWeight(5, 5)).toBeLessThanOrEqual(1);
    expect(decayWeight(-1, 0.5)).toBeGreaterThanOrEqual(0);
    expect(decayWeight(Number.NaN, Number.NaN)).toBeGreaterThanOrEqual(0);
  });

  it('applies no decay at all when pull is 0', () => {
    expect(decayWeight(0.7, 0, 0)).toBeCloseTo(0.7, 6);
  });
});

describe('withinRollingWindow', () => {
  const now = Date.UTC(2026, 7, 3);

  it('accepts something inside the window', () => {
    expect(withinRollingWindow(now - 40 * MS_PER_DAY, now)).toBe(true);
  });

  it('rejects something older than the window', () => {
    expect(withinRollingWindow(now - 200 * MS_PER_DAY, now)).toBe(false);
  });

  it('rejects a missing timestamp', () => {
    expect(withinRollingWindow(null, now)).toBe(false);
  });
});
