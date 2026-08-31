import { describe, it, expect } from 'vitest';
import {
  benjaminiHochberg,
  correlate,
  DEFAULT_FDR,
  effectiveSampleSize,
  MIN_PAIRS,
  pearson,
  pValueForR,
  rankOf,
  spearman,
} from './tests';

/** Deterministic PRNG — Math.random would make these tests flaky by design. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('pearson', () => {
  it('is 1 for a perfect straight line and -1 for its mirror', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
  });

  // A constant series has no correlation to measure. Returning NaN here is how
  // a nonsense row floats to the top of a ranking.
  it('returns 0 rather than NaN for a constant series', () => {
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBe(0);
  });
});

describe('rankOf', () => {
  it('ranks from 1 and averages ties', () => {
    expect(rankOf([10, 20, 30])).toEqual([1, 2, 3]);
    // Two values tied for ranks 2 and 3 both take 2.5.
    expect(rankOf([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });
});

describe('spearman', () => {
  // The reason rank correlation is the default here: this relationship is
  // perfectly monotone but violently non-linear, and Pearson understates it.
  it('sees a monotone curve that Pearson understates', () => {
    const xs = [1, 2, 3, 4, 5, 6];
    const ys = xs.map((x) => Math.exp(x));
    expect(spearman(xs, ys)).toBeCloseTo(1);
    expect(pearson(xs, ys)).toBeLessThan(0.95);
  });
});

describe('pValueForR', () => {
  // Pinned against known values: r = 0.5 at n = 30 is p ~ 0.0049.
  it('agrees with the t transform on a known case', () => {
    expect(pValueForR(0.5, 30)).toBeCloseTo(0.0049, 3);
  });

  it('gives no evidence for no correlation', () => {
    expect(pValueForR(0, 50)).toBeCloseTo(1, 6);
  });

  it('refuses to compute below three points', () => {
    expect(pValueForR(0.99, 2)).toBe(1);
  });

  it('falls as n rises for the same effect size', () => {
    expect(pValueForR(0.4, 100)).toBeLessThan(pValueForR(0.4, 20));
  });
});

describe('correlate', () => {
  // Pairwise deletion. Imputing a missing day with a mean is how an outage
  // becomes a relationship.
  it('drops a day either side could not see', () => {
    const xs = [1, 2, null, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const ys = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
    const res = correlate(xs, ys, 'pearson');
    expect(res.n).toBe(14);
    expect(res.r).toBeCloseTo(1);
  });

  it('refuses to have an opinion below the minimum pair count', () => {
    const xs = Array.from({ length: MIN_PAIRS - 1 }, (_, i) => i);
    const res = correlate(xs, xs);
    expect(res.n).toBeLessThan(MIN_PAIRS);
    expect(res.r).toBe(0);
    expect(res.p).toBe(1);
  });
});

describe('time-series effective sample size', () => {
  it('discounts two persistent daily series', () => {
    const xs = Array.from({ length: 60 }, (_, i) => i + Math.sin(i) * 0.01);
    const ys = xs.map((x) => x * 2);
    expect(effectiveSampleSize(xs, ys)).toBeLessThan(10);
  });
});

describe('benjaminiHochberg', () => {
  it('leaves a single clear result significant', () => {
    const out = benjaminiHochberg([{ item: 'a', p: 0.001 }]);
    expect(out[0].significant).toBe(true);
    expect(out[0].qValue).toBeCloseTo(0.001);
  });

  // The step people leave out. Without the running minimum a less significant
  // test can end up with a smaller adjusted p than a more significant one.
  it('keeps adjusted p monotone in the raw ordering', () => {
    const out = benjaminiHochberg([
      { item: 'a', p: 0.01 },
      { item: 'b', p: 0.02 },
      { item: 'c', p: 0.03 },
      { item: 'd', p: 0.04 },
    ]);
    const qs = out.map((o) => o.qValue);
    const sortedByP = out.slice().sort((x, y) => x.p - y.p).map((o) => o.qValue);
    for (let i = 1; i < sortedByP.length; i++) {
      expect(sortedByP[i]).toBeGreaterThanOrEqual(sortedByP[i - 1] - 1e-12);
    }
    expect(qs).toHaveLength(4);
  });

  it('preserves input order in the returned array', () => {
    const out = benjaminiHochberg([
      { item: 'first', p: 0.9 },
      { item: 'second', p: 0.001 },
    ]);
    expect(out[0].item).toBe('first');
    expect(out[1].item).toBe('second');
  });

  // THE test this file exists for. 24 metrics is 276 pairs. On pure noise, an
  // uncorrected sweep at p < 0.05 finds about 14 "relationships"; the model
  // would then write fourteen confident sentences about John's life, all false.
  it('suppresses the false discoveries an uncorrected sweep would report', () => {
    const rnd = mulberry32(20260826);
    const METRICS = 24;
    const DAYS = 60;

    // Pure noise. There is nothing here to find, by construction.
    const series: number[][] = [];
    for (let m = 0; m < METRICS; m++) {
      series.push(Array.from({ length: DAYS }, () => rnd()));
    }

    const raw: Array<{ item: string; p: number }> = [];
    for (let i = 0; i < METRICS; i++) {
      for (let j = i + 1; j < METRICS; j++) {
        const res = correlate(series[i], series[j]);
        raw.push({ item: `${i}x${j}`, p: res.p });
      }
    }
    expect(raw).toHaveLength((METRICS * (METRICS - 1)) / 2); // 276

    const naive = raw.filter((x) => x.p < 0.05).length;
    const corrected = benjaminiHochberg(raw, DEFAULT_FDR).filter((x) => x.significant).length;

    // The uncorrected sweep finds things. That is the whole problem.
    expect(naive).toBeGreaterThan(5);
    // The corrected one finds few or none on data with no structure.
    expect(corrected).toBeLessThanOrEqual(1);
    expect(corrected).toBeLessThan(naive);
  });

  // And it must not be so conservative that it finds nothing real either.
  it('still finds a genuine relationship buried among noise', () => {
    const rnd = mulberry32(77);
    const DAYS = 60;
    const signal = Array.from({ length: DAYS }, () => rnd());
    const echo = signal.map((v) => v * 0.9 + rnd() * 0.1);

    const raw: Array<{ item: string; p: number }> = [
      { item: 'real', p: correlate(signal, echo).p },
    ];
    for (let m = 0; m < 275; m++) {
      const a = Array.from({ length: DAYS }, () => rnd());
      const b = Array.from({ length: DAYS }, () => rnd());
      raw.push({ item: `noise${m}`, p: correlate(a, b).p });
    }

    const out = benjaminiHochberg(raw, DEFAULT_FDR);
    expect(out.find((o) => o.item === 'real')?.significant).toBe(true);
  });
});
