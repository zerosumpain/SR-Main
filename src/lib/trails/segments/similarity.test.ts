import { describe, it, expect } from 'vitest';
import {
  netGradientPct,
  similarByClimb,
  similarByEfficiency,
  MAX_CLIMB_SCORE,
  MAX_EF_RELATIVE_DELTA,
} from './similarity';

function seg(
  id: number,
  distanceM: number,
  gainM: number,
  lossM: number,
  bestEf: number | null = null,
) {
  return {
    id,
    distanceM,
    elevationGainM: gainM,
    elevationLossM: lossM,
    bestEfficiencyFactor: bestEf,
  };
}

describe('netGradientPct', () => {
  it('reads a climb as positive and a descent as negative', () => {
    expect(netGradientPct(seg(1, 1000, 50, 0))).toBe(5);
    expect(netGradientPct(seg(2, 1000, 0, 50))).toBe(-5);
  });

  it('refuses a zero-length segment rather than dividing by it', () => {
    expect(netGradientPct(seg(3, 0, 50, 0))).toBe(0);
  });
});

describe('similarByClimb', () => {
  const ref = seg(1, 1000, 50, 0); // 5% climb, 1 km

  it('ranks the nearest gradient-and-length first', () => {
    const near = seg(2, 1100, 60, 0); // ~5.5%, similar length
    const far = seg(3, 900, 20, 0); // ~2.2%, similar length
    const out = similarByClimb(ref, [far, near]);
    expect(out.map((r) => r.row.id)).toEqual([2, 3]);
  });

  it('never offers a descent as a similar climb', () => {
    const descent = seg(4, 1000, 0, 50); // the same hill, walked down
    expect(similarByClimb(ref, [descent])).toEqual([]);
  });

  it('lets level ground compete for a gentle climb on score alone', () => {
    const gentle = seg(9, 1000, 10, 0); // 1% — barely a climb
    const flat = seg(10, 1000, 0, 0); // gradient exactly 0: not a descent
    expect(similarByClimb(gentle, [flat]).map((r) => r.row.id)).toEqual([10]);
  });

  it('never offers ground of a wildly different length', () => {
    const marathon = seg(5, 42000, 2100, 0); // same gradient, 42× the length
    expect(similarByClimb(ref, [marathon])).toEqual([]);
  });

  it('excludes the reference segment itself', () => {
    expect(similarByClimb(ref, [ref])).toEqual([]);
  });

  it('caps the list at the requested size', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => seg(10 + i, 1000 + i * 10, 50, 0));
    expect(similarByClimb(ref, candidates, 3)).toHaveLength(3);
  });

  it('keeps every returned score within the advertised bound', () => {
    const candidates = [seg(6, 1200, 70, 0), seg(7, 3000, 30, 0), seg(8, 950, 55, 5)];
    for (const { score } of similarByClimb(ref, candidates)) {
      expect(score).toBeLessThanOrEqual(MAX_CLIMB_SCORE);
    }
  });
});

describe('similarByEfficiency', () => {
  const ref = seg(1, 1000, 10, 10, 1.5);

  it('ranks the closest best-EF first', () => {
    const near = seg(2, 5000, 0, 0, 1.52);
    const farther = seg(3, 800, 40, 0, 1.62);
    const out = similarByEfficiency(ref, [farther, near]);
    expect(out.map((r) => r.row.id)).toEqual([2, 3]);
  });

  it('drops candidates outside the relative window', () => {
    const outside = seg(4, 1000, 0, 0, 1.5 * (1 + MAX_EF_RELATIVE_DELTA) + 0.1);
    expect(similarByEfficiency(ref, [outside])).toEqual([]);
  });

  it('needs an EF on both sides', () => {
    const noEf = seg(5, 1000, 0, 0, null);
    expect(similarByEfficiency(ref, [noEf])).toEqual([]);
    expect(similarByEfficiency(seg(6, 1000, 0, 0, null), [ref])).toEqual([]);
  });

  it('excludes the reference segment itself', () => {
    expect(similarByEfficiency(ref, [ref])).toEqual([]);
  });
});
