import { describe, expect, it } from 'vitest';
import { STREAMS, h32, hashString, normal, pickIndex, u01, uniform } from './rand';

describe('h32: counter-based hash RNG', () => {
  it('is a pure function of its inputs', () => {
    expect(h32(1, 2, 3, 4, 5)).toBe(h32(1, 2, 3, 4, 5));
    expect(h32(1, 2, 3, 4, 5)).not.toBe(h32(1, 2, 3, 4, 6));
    expect(h32(0, 0)).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(h32(7, 1, 2 ** 40))).toBe(true);
    // The high word of a large counter matters.
    expect(h32(7, 1, 2 ** 33)).not.toBe(h32(7, 1, 0));
  });

  it('is uniform: χ² over 64 bins for 200,000 sequential counters', () => {
    const bins = new Array<number>(64).fill(0);
    const n = 200000;
    for (let i = 0; i < n; i++) bins[Math.floor(u01(h32(12345, STREAMS.develop, i)) * 64)]++;
    const e = n / 64;
    const chi = bins.reduce((s, b) => s + ((b - e) * (b - e)) / e, 0);
    // 63 degrees of freedom: the 99.9th percentile is about 103.
    expect(chi).toBeLessThan(103);
  });

  it('streams are independent: draws from two streams on the same counters are uncorrelated', () => {
    const n = 50000;
    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const x = uniform(9, 'develop', i);
      const y = uniform(9, 'incident', i);
      sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y;
    }
    const r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    expect(Math.abs(r)).toBeLessThan(0.02);
  });

  it('flipping one input bit flips about half the output bits (avalanche)', () => {
    let total = 0;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      const a = h32(3, 1, i, 0, 0);
      const b = h32(3, 1, i ^ 1, 0, 0);
      let x = (a ^ b) >>> 0;
      let bits = 0;
      while (x) {
        bits += x & 1;
        x >>>= 1;
      }
      total += bits;
    }
    expect(total / trials).toBeGreaterThan(15);
    expect(total / trials).toBeLessThan(17);
  });

  it('normal draws have mean 0 and variance 1', () => {
    let s = 0, ss = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) {
      const z = normal(5, 'world', i);
      s += z;
      ss += z * z;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.02);
    expect(Math.abs(ss / n - 1)).toBeLessThan(0.03);
  });

  it('pickIndex covers its range; hashString is FNV-1a 32', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(pickIndex(6, 1, 'deals', i));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
  });

  it('pins a few known values (a change here re-randomises every saved county)', () => {
    expect([h32(0, 0), h32(42, STREAMS.develop, 1, 2, 3), h32(-1, STREAMS.world, 2 ** 31)]).toMatchInlineSnapshot(`
      [
        4003277130,
        736772870,
        500258502,
      ]
    `);
  });
});
