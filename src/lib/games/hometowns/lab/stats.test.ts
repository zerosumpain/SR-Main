// The Lab's statistics and gate arithmetic (WP5, spec §11.3–§11.4): the
// numbers every gate is judged by, checked against hand-worked values.

import { describe, expect, it } from 'vitest';
import { bootstrap, correlation, detrend, dominantCycle, gini, longestRun, maxInWindow, median, quantile, ratioCI, seeded, shareCI, signChanges } from '../../../../../scripts/hometowns/lab/stats';
import { composite, drawdown } from '../../../../../scripts/hometowns/lab/gates';
import { top3Share } from '../../../../../scripts/hometowns/lab/observe';
import { lineupFor, LINEUPS } from '../../../../../scripts/hometowns/lab/experiments';
import { scaleValue, sweepablePaths, parseVariant } from '../../../../../scripts/hometowns/lab/variant';
import type { TownSummary } from '../../../../../scripts/hometowns/lab/run';

describe('Lab statistics', () => {
  it('quantiles interpolate, and a never-reached milestone (Infinity) sorts last', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(quantile([0, 10], 0.25)).toBe(2.5);
    expect(median([1, 2, Infinity])).toBe(2);
    expect(median([1, Infinity, Infinity])).toBe(Infinity);
  });

  it('bootstraps are seeded: the same data give the same interval', () => {
    const xs = Array.from({ length: 50 }, (_, i) => (i * 37) % 11);
    const a = bootstrap(xs, median, 300, 5);
    const b = bootstrap(xs, median, 300, 5);
    expect(a).toEqual(b);
    expect(a.lo).toBeLessThanOrEqual(a.est);
    expect(a.hi).toBeGreaterThanOrEqual(a.est);
    const r = ratioCI([2, 2, 2, 2], [1, 1, 1, 1]);
    expect(r.est).toBe(2);
    expect(r.lo).toBe(2);
    expect(shareCI([true, false, true, true]).est).toBe(0.75);
    const u = seeded(1);
    expect(u()).not.toBe(u());
  });

  it('Gini is 0 for equal towns and grows with inequality', () => {
    expect(gini([5, 5, 5, 5])).toBeCloseTo(0, 12);
    expect(gini([0, 0, 0, 10])).toBeCloseTo(0.75, 12);
    expect(gini([1, 2, 3, 4])).toBeCloseTo(0.25, 12);
  });

  it('correlation, detrending and the dominant cycle', () => {
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(correlation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
    const line = detrend([1, 3, 5, 7, 9]);
    for (const x of line) expect(Math.abs(x)).toBeLessThan(1e-9);
    // A 12-month cycle on a rising trend: the trend is removed and the period found.
    const xs = Array.from({ length: 120 }, (_, t) => 100 + t + 10 * Math.sin((2 * Math.PI * t) / 12));
    const c = dominantCycle(xs);
    expect(c.period).toBeCloseTo(12, 6);
    expect(c.peakRatio).toBeGreaterThan(10);
  });

  it('counts meter sign changes with hysteresis, in any window', () => {
    // A meter resting near zero does not flip; crossing the band does.
    expect(signChanges([3, -3, 4, -2, 1], 5)).toEqual([]);
    expect(signChanges([10, -10, 10, 3, -10], 5)).toEqual([1, 2, 4]);
    expect(maxInWindow([1, 2, 4, 50, 51], 5)).toBe(3);
    expect(longestRun([100, 100, 50, 100, 100, 100], (x) => x >= 99)).toBe(3);
  });

  it('the Why share is |top three| over |all terms|', () => {
    expect(top3Share(new Map([['a', 6], ['b', -3], ['c', 1], ['d', 0]]))).toBe(1);
    expect(top3Share(new Map([['a', 4], ['b', -3], ['c', 2], ['d', 1]]))).toBeCloseTo(0.9, 12);
    expect(top3Share(new Map())).toBe(-1);
  });

  it('the G1 composite and the G8 drawdown', () => {
    const t = { pop: [100, 200], happy: [50, 80], helper: [0, 1] } as unknown as TownSummary;
    expect(composite(t)).toBeCloseTo(200 * 0.8 * 0.5, 9);
    expect(drawdown([100, 120, 90, 130])).toBeCloseTo(0.25, 12);
    expect(drawdown([1, 2, 3])).toBe(0);
  });
});

describe('Lab plans and variants', () => {
  it('every lineup has Balanced, and rotation sends every bot to every site', () => {
    for (const L of LINEUPS) expect(L).toContain('balanced');
    const sites = new Map<string, Set<number>>();
    for (let seed = 0; seed < LINEUPS.length * 6; seed++)
      lineupFor(seed).forEach((b, i) => {
        if (!sites.has(b)) sites.set(b, new Set());
        sites.get(b)!.add(i);
      });
    for (const [, s] of sites) expect(s.size).toBe(6);
    expect(lineupFor(4, 4)).toHaveLength(4);
    expect(lineupFor(4, 4)).toContain('balanced');
  });

  it('scales every number in a leaf and lists only leaves with a real range', () => {
    expect(scaleValue(0.3, 2)).toBeCloseTo(0.6, 12);
    expect(scaleValue([100, 200], 1.2)).toEqual([120, 240]);
    expect(scaleValue({ friendly: 1.4, spirited: 1 }, 0.5)).toEqual({ friendly: 0.7, spirited: 0.5 });
    const paths = sweepablePaths();
    expect(paths.length).toBeGreaterThan(50);
    expect(paths).toContain('develop.pGrow');
    expect(paths).not.toContain('finance.ranges.homes'); // min = max: not tunable
    expect(parseVariant({ 'develop.pGrow': 0.4 }, 'x').overrides['develop.pGrow']).toEqual({ set: 0.4 });
    expect(parseVariant({ label: 'y', overrides: { a: { mul: 2 } } }, 'x').label).toBe('y');
  });
});
