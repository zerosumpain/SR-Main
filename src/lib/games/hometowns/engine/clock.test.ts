// The clock without Date in the engine (tests may use Date to build inputs).

import { describe, expect, it } from 'vitest';
import {
  calendarMonth,
  ceilToGrid,
  civilFromDays,
  daysFromCivil,
  effectiveNow,
  gridTickAt,
  hello,
  isCountyWeek,
  londonOffsetMs,
  napCheck,
  napStartAt,
  nextRegionalDayAt,
  setPause,
  weekday,
} from './clock';
import { createCounty } from './county';
import type { CountyState } from './types';

const H = 3_600_000;
const settings = { rivalry: 'friendly' as const, mishaps: 'mild' as const, youngestOrder: [], perSeat: {} };
const county = (epoch: number): CountyState => createCounty({ seed: 1, params: 'v1', settings, epoch, now: epoch });

describe('civil calendar', () => {
  it('matches the platform calendar over four centuries', () => {
    for (let d = -150000; d < 150000; d += 997) {
      const dt = new Date(d * 86400000);
      expect(civilFromDays(d)).toEqual([dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()]);
      expect(daysFromCivil(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())).toBe(d);
      expect(weekday(d)).toBe(dt.getUTCDay());
    }
  });

  it('knows British Summer Time (last Sundays of March and October, 01:00 UTC)', () => {
    expect(londonOffsetMs(Date.UTC(2026, 2, 29, 0, 59))).toBe(0);
    expect(londonOffsetMs(Date.UTC(2026, 2, 29, 1, 0))).toBe(H);
    expect(londonOffsetMs(Date.UTC(2026, 9, 25, 0, 59))).toBe(H);
    expect(londonOffsetMs(Date.UTC(2026, 9, 25, 1, 0))).toBe(0);
    expect(londonOffsetMs(Date.UTC(2027, 0, 10))).toBe(0);
    expect(calendarMonth(Date.UTC(2026, 11, 31, 23, 30))).toBe(11);
    // Half past midnight on 1 August in London is still 31 July in UTC.
    expect(calendarMonth(Date.UTC(2026, 6, 31, 23, 30))).toBe(7);
  });
});

describe('the county grid and the Regional Day', () => {
  const epoch = Date.UTC(2026, 9, 20, 12, 0); // a Tuesday, BST

  it('counts completed ticks', () => {
    const c = county(epoch);
    expect(gridTickAt(c, epoch)).toBe(0);
    expect(gridTickAt(c, epoch + 1_800_000 - 1)).toBe(0);
    expect(gridTickAt(c, epoch + 1_800_000)).toBe(1);
    expect(ceilToGrid(c, epoch + 1)).toBe(epoch + 1_800_000);
  });

  it('falls at 18:00 London time, across the October clock change', () => {
    const c = county(epoch);
    expect(nextRegionalDayAt(c)).toBe(Date.UTC(2026, 9, 20, 17, 0)); // 18:00 BST
    c.lastRegionalDayAt = Date.UTC(2026, 9, 24, 17, 0);
    expect(nextRegionalDayAt(c)).toBe(Date.UTC(2026, 9, 25, 18, 0)); // 18:00 GMT, the change-over Sunday
    expect(isCountyWeek(c, Date.UTC(2026, 9, 25, 18, 0), 5)).toBe(true);
    expect(isCountyWeek(c, Date.UTC(2026, 9, 26, 18, 0), 6)).toBe(false);
  });

  it('dev clock: a Regional Day every 48 ticks', () => {
    const c = createCounty({ seed: 1, params: 'v1', settings, epoch, now: epoch, devTickMs: 30_000 });
    expect(nextRegionalDayAt(c)).toBe(epoch + 48 * 30_000);
    c.dayIndex = 2;
    expect(nextRegionalDayAt(c)).toBe(epoch + 3 * 48 * 30_000);
  });

  it('naps at exactly lastHelloAt + 72 h on the grid (A21), and a hello wakes it by whole ticks', () => {
    const c = county(epoch);
    c.lastHelloAt = epoch + 1000;
    const at = napStartAt(c, 72 * H);
    expect(at).toBe(epoch + 72 * H + 1_800_000);
    expect(effectiveNow(c, epoch + 100 * H, 72 * H)).toBe(at);
    expect(napCheck(c, epoch + 100 * H, 72 * H)).toBe(true);
    expect(c.nap).toEqual({ since: at });
    const g = gridTickAt(c, at);
    hello(c, epoch + 100 * H + 7, 72 * H);
    expect(c.nap).toBeNull();
    expect(c.pausedMs % c.tickMs).toBe(0);
    // The grid resumes where it slept.
    expect(gridTickAt(c, epoch + 100 * H + 7)).toBe(g);
  });

  it('a pause freezes the grid and shifts it by whole ticks', () => {
    const c = county(epoch);
    setPause(c, true, epoch + 10 * 1_800_000 + 5);
    const since = c.pause!.since;
    expect(effectiveNow(c, epoch + 50 * H, 72 * H)).toBe(since);
    setPause(c, false, epoch + 30 * H);
    expect(c.pause).toBeNull();
    expect(c.pausedMs % c.tickMs).toBe(0);
    expect(c.pauseUsedMs).toBe(c.pausedMs);
  });
});
