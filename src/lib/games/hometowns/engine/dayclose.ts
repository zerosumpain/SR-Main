// The Regional Day's WP1-owned steps: closing each town's day (Why day
// record, day books, history sample, a fresh RealisedDay) and publishing the
// snapshot that every town reads tomorrow. WP3's settlement steps run before
// these (they read t.realised and the day books first).

import { emptyRealised, population, rollDayBooks } from './core';
import { paramsFor } from './params';
import { pushHistoryDay } from './records';
import { snapshotOf } from './snapshot';
import type { CountyState, RegionalContext } from './types';
import { foldWhyDay } from './why';
import { eventAt } from './world';

/** §8.3 step 7, bookkeeping half: close each town's day. */
export function coreCloseDay(c: CountyState, r: RegionalContext): void {
  for (let i = 0; i < c.towns.length; i++) {
    const t = c.towns[i];
    if (t.archived) continue;
    foldWhyDay(t, r.dayIndex);
    pushHistoryDay(t, { pop: population(t), reserves: t.money.reserves });
    rollDayBooks(t);
    t.realised = emptyRealised(r.dayIndex + 1, c.allocations.length, c.contracts.length);
  }
}

/** §8.3 step 9: publish the snapshot (frozen until the next Regional Day). */
export function corePublish(c: CountyState, r: RegionalContext): void {
  const s = snapshotOf(c, r.at, r.month);
  s.dayIndex = r.dayIndex;
  s.event = eventAt(c.seed, r.month, paramsFor(c.paramsVersion));
  c.snapshot = s;
}
