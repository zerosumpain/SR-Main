// The Regional Day's WP1-owned steps: closing each town's day (Why day
// record, day books, history sample, a fresh RealisedDay) and publishing the
// snapshot that every town reads tomorrow. WP3's settlement steps run before
// these (they read t.realised and the day books first).

import { emptyRealised, population, rollDayBooks } from './core';
import { paramsFor } from './params';
import { pushHistoryDay, readHistory } from './records';
import { snapshotOf } from './snapshot';
import type { CountyState, RegionalContext, TownState } from './types';
import { foldWhyDay } from './why';
import { eventAt } from './world';

/** §8.3 step 7, bookkeeping half: close each town's day. */
export function coreCloseDay(c: CountyState, r: RegionalContext): void {
  for (let i = 0; i < c.towns.length; i++) {
    const t = c.towns[i];
    if (t.archived) continue;
    foldWhyDay(t, r.dayIndex);
    const pop = population(t);
    pushHistoryDay(t, { pop, reserves: t.money.reserves });
    awayWindow(t, pop);
    rollDayBooks(t);
    // Plans can only be undone on the day they were built (§9.3): today's entries expire now.
    if (t.undo.length) t.undo = t.undo.filter((e) => e.day > r.dayIndex);
    t.realised = emptyRealised(r.dayIndex + 1, c.allocations.length, c.contracts.length);
  }
}

/** Days in the Away cap's rolling window (§2.4). */
const AWAY_WINDOW_DAYS = 7;

/**
 * The Away cap's reference (§2.4, A34): "net population loss from all
 * causes is capped at 5% of the week-start population in any rolling 7
 * days". Each day close sets weekStartPop to the largest day-close
 * population from 7 days ago up to today, so no rolling week
 * can lose more than the cap however the days fall; weekLoss is how far
 * below it the town now stands. It is kept for every town, so the cap holds
 * from the moment a town turns Away (migration.ts and develop.ts apply it
 * only while the town is Away).
 */
function awayWindow(t: TownState, pop: number): void {
  const days = readHistory(t, 'pop', true);
  let top = pop;
  // Today's close is the ring's last sample; the window reaches back to the close 7 days before it.
  for (let k = Math.max(0, days.length - 1 - AWAY_WINDOW_DAYS); k < days.length; k++) if (days[k] > top) top = days[k];
  t.away.weekStartPop = top;
  t.away.weekLoss = Math.max(0, top - pop);
}

/** §8.3 step 9: publish the snapshot (frozen until the next Regional Day). */
export function corePublish(c: CountyState, r: RegionalContext): void {
  const s = snapshotOf(c, r.at, r.month);
  s.dayIndex = r.dayIndex;
  s.event = eventAt(c.seed, r.month, paramsFor(c.paramsVersion));
  c.snapshot = s;
}
