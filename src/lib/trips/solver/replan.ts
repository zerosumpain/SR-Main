// src/lib/trips/solver/replan.ts
//
// Re-timing and re-planning the rest of a day from "now", for the phone.
//
// retimeDay(day, fromIndex, startMin, input): keeps stops before `fromIndex`
// exactly as they are and re-times the rest in the same order, setting off
// towards `stops[fromIndex]` at `startMin` (fromIndex 0 = leave the stay at
// startMin). Each re-timed stop keeps its planned visit length; locked stops
// keep their planned start (arrive early → wait, late → warning). Nothing is
// dropped or reordered; warnings are recomputed.
//
// replanDay(input): up to three options, best first:
//   shift  — keep everything, push it back (or bring it forward)
//   drop   — when the shifted day has problems, drop nices (closed-on-arrival
//            first, then lowest value) until it works
//   swap / reorder — re-order what is left (locked stops stay put)
// Ranked by simulated cost plus a penalty per dropped nice; identical days
// are offered once. The phone ports this file to Swift, so it sticks to
// simple integer minute arithmetic.

import type { Booking, PlannedDay, PlannedStop, ReplanOption, Stay, Wish } from '../model';
import { fmtMin } from './calendar';
import { itemFromStop, pointOfStop, type DayFrame, type Item } from './items';
import { makeContext, type SolverContext } from './matrix';
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
  return {
    date: day.date,
    stay: stays.find((s) => s.id === day.stayId) ?? null,
    dayStartMin: ctx.rules.dayStartMin,
    dayEndMin: ctx.rules.dayEndMin,
  };
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

function hasProblems(sim: Simulation): boolean {
  return sim.overrunMin > 0 || sim.issues.length > 0;
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

export function replanDay(input: ReplanInput): ReplanOption[] {
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
  const items = toItems(pending, day, input.wishes, input.bookings, ctx);
  if (input.position && at < 0) start.fromPosition = input.position;

  const options: Array<ReplanOption & { score: number }> = [];
  const make = (
    id: string,
    kind: ReplanOption['kind'],
    label: string,
    sim: Simulation,
    dropped: string[],
  ) => {
    const planned = toPlannedDay(frame, sim);
    const end = planned.stops.length ? planned.stops[planned.stops.length - 1].departMin : 0;
    options.push({
      id,
      label,
      kind,
      day: planned,
      dropped,
      endsLaterMin: end - oldEnd,
      score: sim.cost + dropped.length * COST.droppedNice,
    });
  };

  // 1. Shift: same order, re-timed from now.
  const shift = simulate(ctx, frame, start, items);
  const firstPending = pending[0];
  const firstNew = firstPending ? shift.stops.find((s) => s.id === firstPending.id) : undefined;
  const delay = firstPending && firstNew ? firstNew.arriveMin - firstPending.arriveMin : 0;
  make(
    'shift',
    'shift',
    delay > 0
      ? `Push everything back ${delay} min`
      : delay < 0
        ? `Bring everything forward ${-delay} min`
        : 'Keep the plan as it is',
    shift,
    [],
  );

  // 2. Drop nices until the day works.
  if (hasProblems(shift)) {
    let current = items;
    let sim = shift;
    const gone: Item[] = [];
    while (hasProblems(sim)) {
      const candidates = current.filter(droppable);
      if (!candidates.length) break;
      const closed = candidates
        .filter((c) => sim.issues.some((x) => x.itemId === c.id && x.kind === 'closed'))
        .sort(byLowestValue);
      const victim = closed[0] ?? [...candidates].sort(byLowestValue)[0];
      gone.push(victim);
      current = current.filter((c) => c !== victim);
      sim = simulate(ctx, frame, start, current);
    }
    if (gone.length) {
      const names = gone.map((g) => g.title);
      make(
        `drop:${gone.map((g) => g.id).join(',')}`,
        'drop',
        `Drop ${joinNames(names)} (nice-to-have${names.length > 1 ? 's' : ''})`,
        sim,
        gone.map((g) => g.wishId ?? g.id),
      );
    }
  }

  // 3. Re-order what is left (meals re-slotted, anchors stay put).
  const wishItems = items.filter((i) => i.kind === 'wish');
  const meals = items.filter((i) => i.kind === 'meal');
  if (wishItems.length > 1) {
    const cost = (seq: Item[]) => withMeals(ctx, frame, start, seq, meals).sim.cost;
    const ordered = orderDay(wishItems, cost);
    const { seq, sim } = withMeals(ctx, frame, start, ordered, meals);
    const before = wishItems.map((i) => i.id);
    const after = ordered.map((i) => i.id);
    const sameSequence = items.map((i) => i.id).join('|') === seq.map((i) => i.id).join('|');
    if (sim.cost < shift.cost && !sameSequence) {
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

  options.sort(
    (a, b) => a.score - b.score || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id.localeCompare(b.id),
  );
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
