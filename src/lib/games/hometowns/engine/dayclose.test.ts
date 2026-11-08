// The day close's Away-cap reference (spec §2.4, A34): each Regional Day sets
// a town's week-start population to the highest day-close population of the
// last seven days, so no rolling week can lose more than the cap; migration
// and the development scan apply it while the town is Away.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { population } from './core';
import { coreCloseDay } from './dayclose';
import { pushHistoryDay } from './records';
import type { RegionalContext } from './types';

describe('the Away cap reference (§2.4, A34)', () => {
  it('is the highest day-close population from seven days ago up to today', () => {
    const f = fixture('hamlet');
    const c = f.county;
    const t = c.towns[f.town];
    const now = population(t);
    // Nine earlier closes: the two oldest (one of them the highest) are more than seven days back.
    for (const pop of [now + 500, now + 40, now + 30, now + 20, now + 10, now + 60, now + 5, now + 2, now + 1]) pushHistoryDay(t, { pop });
    coreCloseDay(c, { dayIndex: c.dayIndex, at: 0, month: 0 } as unknown as RegionalContext);
    expect(t.away.weekStartPop).toBe(now + 60);
    expect(t.away.weekLoss).toBe(60);
  });
});
