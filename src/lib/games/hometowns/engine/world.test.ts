import { describe, expect, it } from 'vitest';
import { paramsFor } from './params';
import { cycleG, eventAt, slowdownAhead, worldAt } from './world';

const p = paramsFor('v1');
const season = { startMonth: 0, boomBust: false };

describe('the World', () => {
  it('is a pure function of (seed, month)', () => {
    expect(worldAt(9, 1234, season, p)).toEqual(worldAt(9, 1234, season, p));
    expect(worldAt(9, 1234, season, p).G).not.toBe(worldAt(10, 1234, season, p).G);
  });

  it('cycles gently and keeps the base rate in its band', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let m = 0; m < 2400; m++) {
      const w = worldAt(3, m, season, p);
      lo = Math.min(lo, w.G);
      hi = Math.max(hi, w.G);
      expect(w.rBase).toBeGreaterThanOrEqual(0.015);
      expect(w.rBase).toBeLessThanOrEqual(0.06);
      expect(w.seasonProgress).toBeGreaterThanOrEqual(0);
      expect(w.seasonProgress).toBeLessThan(1);
    }
    expect(lo).toBeGreaterThan(0.8);
    expect(hi).toBeLessThan(1.2);
    expect(hi - lo).toBeGreaterThan(0.08); // a visible cycle
    // Within a season manufacturing fades and services rise.
    const a = worldAt(3, 10, season, p);
    const b = worldAt(3, 490, season, p);
    expect(b.goods / b.G).toBeLessThan(a.goods / a.G);
    expect(b.office / b.G).toBeGreaterThan(a.office / a.G);
    expect(cycleG(3, 50, p, true)).not.toBe(cycleG(3, 50, p, false));
  });

  it('has at most one event at a time, lasting 12–24 months, roughly every five days', () => {
    let events = 0;
    let last = '';
    for (let m = 0; m < 12 * 100; m++) {
      const e = eventAt(4, m, p);
      if (e) {
        expect(e.toMonth - e.fromMonth).toBeGreaterThanOrEqual(12);
        expect(e.toMonth - e.fromMonth).toBeLessThanOrEqual(24);
        const key = `${e.id}@${e.fromMonth}`;
        if (key !== last) events++;
        last = key;
      } else last = '';
    }
    expect(events).toBeGreaterThanOrEqual(15);
    expect(events).toBeLessThanOrEqual(25);
    expect(typeof slowdownAhead(4, 100, season, p)).toBe('boolean');
  });
});
