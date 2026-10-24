// What a bot mayor sees (spec §11.1): the same things a phone gets on the
// wire, and nothing more. A phone receives its own town in full (MeWire.town),
// the frozen snapshot, the advisor cards and wants bubbles, the checklist and
// the other towns' public cards; so does a bot. A bot never reads another
// town's private state, and it never reads the month's blackboard, which no
// phone sees either.
//
// The view is built from the county only so the Lab can hand one over; a bot
// must treat everything outside `town` and `snapshot` as read-only facts.

import { population } from '../core';
import { paramsFor, type Params } from '../params';
import { publicCard } from '../snapshot';
import { checklistOf } from '../tiers';
import { isCountyWeek, nextRegionalDayAt } from '../clock';
import type { TownEnv } from '../tick';
import type { CountyState, PublicCard, SeatId, Snapshot, TownState } from '../types';

export interface BotView {
  seat: SeatId;
  townIndex: number;
  /** The bot's own town, in full (the phone's MeWire.town). Bots must not mutate it. */
  town: TownState;
  snapshot: Snapshot;
  params: Params;
  /** The session's instant; moves are stamped from it. */
  now: number;
  dayIndex: number;
  /** Today's Regional Day is Sunday's County Week (the Weekly bot plays then). */
  countyWeek: boolean;
  /** Ms until today's Regional Day (negative once it has passed for today's session). */
  untilRegionalDay: number;
  profile: 'kid' | 'adult';
  pop: number;
  /** Wants bubbles and advisor card ids from the last month end (§5.15, §9.7). */
  wants: string[];
  advisors: string[];
  /** The next tier's checklist (§7) as of the last month end. */
  checklist: { id: string; met: boolean }[];
  /** Every other town's public card, by town index (null for the bot's own). */
  others: (PublicCard | null)[];
  /** What the phone predicts with (§10.9): the lenses run the engine's own field code on it. */
  env: TownEnv;
}

/** The view for `seat` at `now`, from stored state only. */
export function viewOf(c: CountyState, seat: SeatId, now: number): BotView | null {
  const townIndex = c.towns.findIndex((t) => t.seat === seat);
  if (townIndex < 0) return null;
  const t = c.towns[townIndex];
  const p = paramsFor(c.paramsVersion);
  const memo = t.civicMemo;
  const rd = nextRegionalDayAt(c, p.clock.devRegionalTicks);
  return {
    seat,
    townIndex,
    town: t,
    snapshot: c.snapshot,
    params: p,
    now,
    dayIndex: c.dayIndex,
    countyWeek: isCountyWeek(c, rd, c.dayIndex),
    untilRegionalDay: rd - now,
    profile: c.settings.perSeat[seat]?.profile ?? 'adult',
    pop: population(t),
    wants: memo ? memo.wants.map((w) => w.key) : [],
    advisors: memo ? [...memo.advisors] : [],
    checklist: checklistOf(t),
    others: c.towns.map((o, i) => (i === townIndex ? null : publicCard(o))),
    env: { params: p, snapshot: c.snapshot, rivalry: c.settings.rivalry, mishaps: c.settings.mishaps, dayIndex: c.dayIndex },
  };
}
