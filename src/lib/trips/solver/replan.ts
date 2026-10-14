// src/lib/trips/solver/replan.ts
//
// Re-timing and re-planning the rest of a day from "now", for the phone.
//
// retimeDay(day, fromIndex, startMin, input): keeps stops before `fromIndex`
// exactly as they are and re-times the rest in the same order, setting off
// towards `stops[fromIndex]` at `startMin` (fromIndex 0 = leave the stay at
// startMin). Each re-timed stop keeps its planned visit length; a locked stop
// keeps its planned start and end (arrive early → wait; late → its real
// arrival and a "Booked for … — you arrive …" warning, end unchanged).
// Nothing is dropped or reordered; warnings are recomputed.
//
// replanDay(input): up to three options, best first. Locked/booked stops
// NEVER move in any option — they keep their planned arriveMin, waitSec and
// departMin:
//   - Missed slot: a locked stop we cannot reach by its start + 30 min
//     (MISSED_SLOT_GRACE_MIN), going straight there, leaves every option's
//     day, is listed in every option's `dropped`, and every option's day
//     warnings start with "Missed your 09:30 <title> slot".
//   - Late inside the grace: the stop keeps its planned times and gets
//     "Booked for 09:30 — you arrive 09:43"; shift label "Go straight to …".
//   - Unlocked stops that would make a later locked stop late are moved to
//     just after it (shift, reorder) or, in the drop option, the
//     lowest-value nice among them is dropped first (`repair`).
// Options:
//   shift  — same order, re-timed from now (with the moves above)
//   drop   — when the shift has problems or had to move stops: drop nices
//            (squeezing a slot first, then closed-on-arrival, then lowest
//            value) until it works
//   swap / reorder — re-order what is left, then the same repair
// Ranked by simulated cost plus a penalty per dropped nice; identical days
// are offered once. The phone ports this file to Swift, so it sticks to
// simple integer minute arithmetic.

import type { Booking, PlannedDay, PlannedStop, ReplanOption, Stay, Wish } from '../model';
import { fmtMin, cmp } from './calendar';
import { dayFrame, itemFromStop, pointOfStop, type DayFrame, type Item } from './items';
import { chooseLeg, legFromPosition, makeContext, type SolverContext } from './matrix';
import { orderDay } from './order';
import {
  COST,
  byLowestValue,
  droppable,
  freshStart,
  simulate,
  toPlannedDay,
  withMeals,
  type SimStart,
  type Simulation,
} from './timing';
import type { ReplanInput, RetimeInput } from './types';

function frameFor(ctx: SolverContext, day: PlannedDay, stays: Stay[]): DayFrame {
  return dayFrame(ctx.rules, ctx.dayLoads, day.date, stays.find((s) => s.id === day.stayId) ?? null);
}

const isEndStay = (s: PlannedStop) => s.kind === 'stay' && s.id.endsWith(':end');

/** The matrix point we are at after a run of stops (meals sit where the stop before was). */
function pointAfter(prefix: PlannedStop[], stayId: string | null): string | null {
  for (let i = prefix.length - 1; i >= 0; i--) {
    const p = pointOfStop(prefix[i], stayId);
    if (p !== null) return p;
  }
  return null;
}

function startAfter(prefix: PlannedStop[], day: PlannedDay, departMin: number): SimStart {
  const last = prefix[prefix.length - 1];
  return {
    prefixStops: prefix,
    prefixLegs: day.legs.slice(0, Math.max(0, prefix.length - 1)),
    fromPoint: pointAfter(prefix, day.stayId),
    fromStopId: last ? last.id : null,
    departMin,
  };
}

function toItems(
  stops: PlannedStop[],
  day: PlannedDay,
  wishes: Wish[],
  bookings: Booking[],
  ctx: SolverContext,
): Item[] {
  const byId = new Map(wishes.map((w) => [w.id, w]));
  return stops
    .filter((s) => s.kind !== 'stay')
    .map((s) => itemFromStop(s, day.date, byId, bookings, ctx.rules));
}

export function retimeDay(
  day: PlannedDay,
  fromIndex: number,
  startMin: number,
  input: RetimeInput,
): PlannedDay {
  if (day.stops.length === 0) return { ...day, stops: [], legs: [], warnings: [...day.warnings] };
  const ctx = makeContext(input.trip, input.stays, input.wishes, input.matrix);
  const frame = frameFor(ctx, day, input.stays);
  const body = day.stops.filter((s) => !isEndStay(s));
  const i = Math.max(0, Math.min(Math.trunc(fromIndex), body.length));
  let start: SimStart;
  let rest: PlannedStop[];
  if (i === 0 && body[0]?.kind === 'stay' && frame.stay) {
    start = freshStart(frame, startMin, false);
    rest = body.slice(1);
  } else if (i === 0) {
    start = {
      prefixStops: [],
      prefixLegs: [],
      fromPoint: null,
      fromStopId: null,
      departMin: startMin,
    };
    rest = body;
  } else {
    start = startAfter(body.slice(0, i), day, startMin);
    rest = body.slice(i);
  }
  const sim = simulate(ctx, frame, start, toItems(rest, day, input.wishes, input.bookings, ctx));
  return toPlannedDay(frame, sim);
}

/** Problems dropping a nice can fix (lateness for a slot is `repair`'s job). */
export function hasProblems(sim: Simulation): boolean {
  return sim.overrunMin > 0 || sim.issues.some((x) => x.kind !== 'late-for-slot');
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function dayKey(day: PlannedDay): string {
  return day.stops.map((s) => `${s.id}@${s.arriveMin}-${s.departMin}`).join('|');
}

const KIND_RANK: Record<ReplanOption['kind'], number> = {
  shift: 0,
  swap: 1,
  reorder: 2,
  drop: 3,
};

/** A booked/locked stop more than this late is a missed slot. */
export const MISSED_SLOT_GRACE_MIN = 30;

interface Repaired {
  seq: Item[];
  sim: Simulation;
  dropped: Item[];
  /** [moved stop, the locked stop it now follows]. */
  moved: Array<[Item, Item]>;
}

/**
 * Make a sequence respect its locked stops. While a locked stop would be
 * late because of unlocked stops before it (since the previous locked stop),
 * either drop the lowest-value nice among them (`dropFirst`) or move the last
 * of them to just after the locked stop. A locked stop that is late with
 * nothing before it to remove stays, with its "Booked for" warning — only
 * possible within the missed-slot grace period.
 */
export function repair(
  ctx: SolverContext,
  frame: DayFrame,
  start: SimStart,
  seq: Item[],
  dropFirst: boolean,
): Repaired {
  let current = [...seq];
  const dropped: Item[] = [];
  const moved: Array<[Item, Item]> = [];
  for (let guard = 0; guard < 4 * seq.length + 4; guard++) {
    const sim = simulate(ctx, frame, start, current);
    let fixed = false;
    let prevLocked = -1;
    for (let k = 0; k < current.length; k++) {
      const item = current[k];
      if (!item.locked) continue;
      const late = sim.issues.some((x) => x.itemId === item.id && x.kind === 'late-for-slot');
      const between = current.slice(prevLocked + 1, k).filter((i) => !i.locked);
      if (late && between.length) {
        const nice = dropFirst ? between.filter(droppable).sort(byLowestValue)[0] : undefined;
        if (nice) {
          current = current.filter((i) => i !== nice);
          dropped.push(nice);
        } else {
          // Move the last sight rather than a meal: a meal after the slot
          // would only run late.
          const sights = between.filter((i) => i.kind === 'wish');
          const mover = (sights.length ? sights : between)[(sights.length ? sights : between).length - 1];
          const rest = current.filter((i) => i !== mover);
          const at = rest.indexOf(item);
          current = [...rest.slice(0, at + 1), mover, ...rest.slice(at + 1)];
          moved.push([mover, item]);
        }
        fixed = true;
        break;
      }
      prevLocked = k;
    }
    if (!fixed) return { seq: current, sim, dropped, moved };
  }
  return { seq: current, sim: simulate(ctx, frame, start, current), dropped, moved };
}

/** Where the person is in today's plan, as the re-planners see it. */
export interface Situation {
  ctx: SolverContext;
  frame: DayFrame;
  done: Set<string>;
  /** Stops already behind us (kept as they are), ending with where we are. */
  prefix: PlannedStop[];
  /** Today's stops still to do (no stays), as planned. */
  pending: PlannedStop[];
  /** Index of `atStopId` in the day (without the end stay), or -1. */
  at: number;
  leave: number;
  start: SimStart;
  /** Pending stops as items: missed slots removed, locked stops held. */
  items: Item[];
  missed: Item[];
  missedWarnings: string[];
  missedIds: string[];
  /** Earliest arrival at an item going straight there from `start`. */
  direct: (item: Item) => number;
  oldEnd: number;
}

export function situation(input: ReplanInput): Situation {
  const { day } = input;
  const ctx = makeContext(input.trip, input.stays, input.wishes, input.matrix);
  const frame = frameFor(ctx, day, input.stays);
  const done = new Set(input.doneStopIds);
  const body = day.stops.filter((s) => !isEndStay(s));
  const oldEnd = day.stops.length ? day.stops[day.stops.length - 1].departMin : 0;

  // Where we are in the day.
  const at = input.atStopId ? body.findIndex((s) => s.id === input.atStopId) : -1;
  let h = at;
  if (at < 0) {
    h = body[0]?.kind === 'stay' ? 0 : -1;
    while (h + 1 < body.length && done.has(body[h + 1].id)) h++;
  }
  const prefix = body.slice(0, h + 1).map((s) => ({ ...s, warnings: [...s.warnings] }));
  const pending = body.slice(h + 1).filter((s) => !done.has(s.id) && s.kind !== 'stay');
  const last = prefix[prefix.length - 1];
  const stillThere = last !== undefined && (at >= 0 || last.kind === 'stay');
  // Still at a stop (or the stay): set off once the visit and its buffer are
  // over, or now if that has passed. Otherwise we are already on the move.
  const bufferMin = last?.kind === 'wish' ? Math.round(ctx.rules.bufferSec / 60) : 0;
  const leave = stillThere ? Math.max(input.nowMin, last.departMin + bufferMin) : input.nowMin;
  if (stillThere && input.nowMin > last.departMin) last.departMin = input.nowMin;

  const start = startAfter(prefix, day, leave);
  if (input.position && at < 0) start.fromPosition = input.position;
  const all = toItems(pending, day, input.wishes, input.bookings, ctx);

  // Missed slots: a locked stop we cannot reach within the grace period
  // even going straight there. It leaves today's plan, is listed in every
  // option's `dropped`, and every option's day carries a warning.
  const direct = (item: Item): number => {
    if (item.point === null) return leave;
    if (start.fromPosition)
      return leave + Math.ceil(legFromPosition(ctx, start.fromPosition, item.point).durationSec / 60);
    if (start.fromPoint === null) return leave;
    return leave + Math.ceil(chooseLeg(ctx, start.fromPoint, item.point).durationSec / 60);
  };
  const missed = all.filter(
    (i) => i.locked && i.fixedStartMin !== null && direct(i) > i.fixedStartMin + MISSED_SLOT_GRACE_MIN,
  );
  const items = all
    .filter((i) => !missed.includes(i))
    .map((i) => {
      const planned = i.locked ? pending.find((p) => p.id === i.id) : undefined;
      return planned ? { ...i, heldArriveMin: planned.arriveMin } : i;
    });
  return {
    ctx,
    frame,
    done,
    prefix,
    pending,
    at,
    leave,
    start,
    items,
    missed,
    missedWarnings: missed.map((m) => `Missed your ${fmtMin(m.fixedStartMin as number)} ${m.title} slot`),
    missedIds: missed.map((m) => m.wishId ?? m.id),
    direct,
    oldEnd,
  };
}

/**
 * Make a sequence work without reordering it: drop the nices squeezing a
 * locked slot, then any closed on arrival, then the lowest value, until the
 * day has no problems; unlocked stops a slot still can't absorb move after it.
 */
export function settle(
  ctx: SolverContext,
  frame: DayFrame,
  start: SimStart,
  seq: Item[],
): { seq: Item[]; sim: Simulation; gone: Item[]; moved: Array<[Item, Item]> } {
  const first = repair(ctx, frame, start, seq, true);
  let current = first.seq;
  let sim = first.sim;
  const gone: Item[] = [...first.dropped];
  let moved = first.moved;
  while (hasProblems(sim)) {
    const candidates = current.filter(droppable);
    if (!candidates.length) break;
    const closed = candidates
      .filter((c) => sim.issues.some((x) => x.itemId === c.id && x.kind === 'closed'))
      .sort(byLowestValue);
    const victim = closed[0] ?? [...candidates].sort(byLowestValue)[0];
    const next = repair(
      ctx,
      frame,
      start,
      current.filter((c) => c !== victim),
      true,
    );
    // Only drop when it buys more than the nice is worth.
    if (next.sim.cost + COST.droppedNice * (next.dropped.length + 1) >= sim.cost) break;
    gone.push(victim);
    current = next.seq;
    sim = next.sim;
    gone.push(...next.dropped);
    moved = next.moved;
  }
  return { seq: current, sim, gone, moved };
}

export function replanDay(input: ReplanInput): ReplanOption[] {
  const { ctx, frame, pending, start, items, missed, missedWarnings, missedIds, direct, oldEnd } =
    situation(input);

  const options: Array<ReplanOption & { score: number }> = [];
  const make = (
    id: string,
    kind: ReplanOption['kind'],
    label: string,
    sim: Simulation,
    dropped: string[],
  ) => {
    const planned = toPlannedDay(frame, sim);
    planned.warnings = [...missedWarnings, ...planned.warnings];
    const end = planned.stops.length ? planned.stops[planned.stops.length - 1].departMin : 0;
    options.push({
      id,
      label,
      kind,
      day: planned,
      dropped: [...missedIds, ...dropped],
      endsLaterMin: end - oldEnd,
      score: sim.cost + dropped.length * COST.droppedNice,
    });
  };
  const repairSeq = (seq: Item[], dropFirst: boolean) => repair(ctx, frame, start, seq, dropFirst);
  const movedNote = (moved: Array<[Item, Item]>) =>
    moved.length
      ? `, ${joinNames(moved.map(([m]) => (m.kind === 'meal' ? m.title.toLowerCase() : m.title)))} after the ${joinNames(
          [...new Set(moved.map(([, anchor]) => anchor.title))],
        )} slot`
      : '';

  // 1. Shift: same order, re-timed from now. Unlocked stops are pushed back
  // only as far as the next locked stop allows; whatever no longer fits
  // before a slot moves to just after it.
  const shift = repairSeq(items, false);
  const firstFree = pending.find((p) => !p.locked && shift.sim.stops.some((s) => s.id === p.id));
  const firstNew = firstFree ? shift.sim.stops.find((s) => s.id === firstFree.id) : undefined;
  const delay = firstFree && firstNew ? firstNew.arriveMin - firstFree.arriveMin : 0;
  const lateSlot = items.find(
    (i) => i.locked && shift.sim.issues.some((x) => x.itemId === i.id && x.kind === 'late-for-slot'),
  );
  const shiftLabel = missed.length
    ? `Carry on without the missed ${joinNames(missed.map((m) => m.title))} slot`
    : lateSlot
      ? `Go straight to the ${lateSlot.title} — about ${direct(lateSlot) - (lateSlot.fixedStartMin as number)} min late`
      : delay > 0
        ? `Push ${items.some((i) => i.locked) ? 'the rest' : 'everything'} back ${delay} min`
        : delay < 0
          ? `Bring everything forward ${-delay} min`
          : 'Keep the plan as it is';
  make('shift', 'shift', `${shiftLabel}${movedNote(shift.moved)}`, shift.sim, []);

  // 2. Drop nices until the day works: first those squeezing a slot, then
  // any that would be closed on arrival, then the lowest value.
  if (hasProblems(shift.sim) || shift.moved.length) {
    const { sim, gone, moved } = settle(ctx, frame, start, items);
    if (gone.length) {
      const names = gone.map((g) => g.title);
      make(
        `drop:${gone.map((g) => g.id).join(',')}`,
        'drop',
        `Drop ${joinNames(names)} (nice-to-have${names.length > 1 ? 's' : ''})${movedNote(moved)}`,
        sim,
        gone.map((g) => g.wishId ?? g.id),
      );
    }
  }

  // 3. Re-order what is left (meals re-slotted, locked stops stay put).
  const wishItems = items.filter((i) => i.kind === 'wish');
  const meals = items.filter((i) => i.kind === 'meal');
  if (wishItems.length > 1) {
    const cost = (seq: Item[]) => withMeals(ctx, frame, start, seq, meals).sim.cost;
    const ordered = orderDay(wishItems, cost);
    const placed = withMeals(ctx, frame, start, ordered, meals).seq;
    const { seq, sim } = repairSeq(placed, false);
    const before = wishItems.map((i) => i.id);
    const after = seq.filter((i) => i.kind === 'wish').map((i) => i.id);
    const sameSequence = shift.seq.map((i) => i.id).join('|') === seq.map((i) => i.id).join('|');
    if (sim.cost < shift.sim.cost && !sameSequence) {
      const swapped =
        before.length >= 2 &&
        before[0] === after[1] &&
        before[1] === after[0] &&
        before.slice(2).join('|') === after.slice(2).join('|');
      if (swapped) make('swap', 'swap', 'Swap the next two', sim, []);
      else if (before.join('|') === after.join('|')) {
        const moved = sim.stops.filter((s) => s.kind === 'meal' && meals.some((m) => m.id === s.id));
        const label = moved.length
          ? `Move ${joinNames(moved.map((m) => `${m.title.toLowerCase()} to ${fmtMin(m.arriveMin + Math.round(m.waitSec / 60))}`))}`
          : 'Reorder the rest of the day';
        make('reorder', 'reorder', label, sim, []);
      } else make('reorder', 'reorder', 'Reorder the rest of the day', sim, []);
    }
  }

  options.sort((a, b) => a.score - b.score || KIND_RANK[a.kind] - KIND_RANK[b.kind] || cmp(a.id, b.id));
  const seen = new Set<string>();
  const out: ReplanOption[] = [];
  for (const o of options) {
    const key = dayKey(o.day);
    if (seen.has(key)) continue;
    seen.add(key);
    const { score: _score, ...option } = o;
    out.push(option);
    if (out.length === 3) break;
  }
  return out;
}
