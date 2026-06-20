import { describe, it, expect } from 'vitest';
import {
  nextSlackWindows,
  breydonAdvice,
  parseTides,
  fmtTideTime,
  gorlestonExtremesOnDay,
  hasRealDataForDay,
  bridgeLowWaters,
  breydonCrossings,
} from './tide';
import type { TideTable } from './types';

describe('nextSlackWindows', () => {
  const lw = new Date('2026-06-21T06:00:00Z');

  it('returns `count` windows (default 4)', () => {
    expect(nextSlackWindows(lw).length).toBe(4);
    expect(nextSlackWindows(lw, 2).length).toBe(2);
  });

  it('first window is centred at low water + 1 hour (slack)', () => {
    const [w0] = nextSlackWindows(lw);
    expect(w0.mid.getTime()).toBe(lw.getTime() + 3_600_000);
  });

  it('window is ±90 min around the mid', () => {
    const [w0] = nextSlackWindows(lw);
    expect(w0.start.getTime()).toBe(w0.mid.getTime() - 90 * 60_000);
    expect(w0.end.getTime()).toBe(w0.mid.getTime() + 90 * 60_000);
  });

  it('consecutive mids are spaced ≈ 12 h 25 m (semidiurnal period)', () => {
    const ws = nextSlackWindows(lw, 4);
    for (let i = 1; i < ws.length; i++) {
      const gapMin = (ws[i].mid.getTime() - ws[i - 1].mid.getTime()) / 60_000;
      expect(gapMin).toBeCloseTo(745, 0); // 44700 s = 745 min = 12h25m
    }
  });
});

describe('breydonAdvice', () => {
  it('returns the fixed guidance string', () => {
    expect(breydonAdvice()).toBe(
      'Breydon Water is tidal — cross at slack water, about 1 hour after low water at Great Yarmouth. Plan ~2¼ h from Acle or ~2 h from Reedham. Keep inside the red & green posts.',
    );
  });
});

// ---- table-driven tide times (real Gorleston data, 18 July 2026) ----
const TIDES: TideTable = {
  station: 'Gorleston-on-Sea (Great Yarmouth)',
  source: 'test',
  events: [
    { t: '2026-07-17T23:44:00Z', type: 'high', h: 2.66 }, // 00:44 BST 18th
    { t: '2026-07-18T05:30:00Z', type: 'low', h: 0.97 }, //  06:30 BST
    { t: '2026-07-18T11:33:00Z', type: 'high', h: 2.89 }, // 12:33 BST
    { t: '2026-07-18T18:07:00Z', type: 'low', h: 0.23 }, //  19:07 BST
    { t: '2026-07-19T00:28:00Z', type: 'high', h: 2.58 }, // 01:28 BST 19th
    { t: '2026-07-19T06:11:00Z', type: 'low', h: 1.04 }, //  07:11 BST 19th
  ],
};
const DAY18 = new Date('2026-07-18T12:00:00Z'); // a Europe/London 18 July instant

describe('parseTides + fmtTideTime', () => {
  it('parses & sorts events; renders BST clock time', () => {
    const ex = parseTides(TIDES);
    expect(ex.length).toBe(6);
    expect(ex[0].at.getTime()).toBeLessThan(ex[1].at.getTime());
    // 05:30 UTC in July → 06:30 BST
    expect(fmtTideTime(new Date('2026-07-18T05:30:00Z'))).toBe('06:30');
  });
  it('empty/missing table → no extremes', () => {
    expect(parseTides(null)).toEqual([]);
    expect(parseTides({ station: '', source: '', events: [] })).toEqual([]);
  });
});

describe('gorlestonExtremesOnDay', () => {
  it('groups by Europe/London day (late-evening UTC rolls into BST next day)', () => {
    const ex = gorlestonExtremesOnDay(TIDES, DAY18);
    // 23:44Z(17th)→00:44 BST 18th, 05:30Z low, 11:33Z high, 18:07Z low = 4 on the 18th
    expect(ex.map((e) => e.type)).toEqual(['high', 'low', 'high', 'low']);
  });
  it('hasRealDataForDay is true within coverage, false outside', () => {
    expect(hasRealDataForDay(TIDES, DAY18)).toBe(true);
    expect(hasRealDataForDay(TIDES, new Date('2026-12-25T12:00:00Z'))).toBe(false);
  });
});

describe('bridgeLowWaters', () => {
  it('Potter Heigham (+240 min) low waters on 18 July = LW Gorleston + 4 h', () => {
    const lows = bridgeLowWaters(TIDES, 240, DAY18);
    // 05:30Z+4h=09:30Z(10:30 BST), 18:07Z+4h=22:07Z(23:07 BST)
    expect(lows.map((l) => fmtTideTime(l.at))).toEqual(['10:30', '23:07']);
    expect(lows.every((l) => !l.approx)).toBe(true);
  });
  it('projects approximate low waters beyond the table', () => {
    const lows = bridgeLowWaters(TIDES, 240, new Date('2026-12-25T12:00:00Z'));
    expect(lows.length).toBeGreaterThan(0);
    expect(lows.every((l) => l.approx)).toBe(true);
  });
});

describe('breydonCrossings', () => {
  it('slack ≈ LW Gorleston + 2 h (Yarmouth LW + 1 h) on 18 July', () => {
    const w = breydonCrossings(TIDES, DAY18);
    // first Gorleston LW 05:30Z → Yarmouth LW 06:30Z → slack mid 07:30Z (08:30 BST)
    expect(fmtTideTime(w[0].mid)).toBe('08:30');
    expect(w[0].end.getTime() - w[0].start.getTime()).toBe(180 * 60_000); // ±90 min
  });
});
