// src/lib/trips/solver/timing.ts
//
// Forward time-fitting. Walks a day's sequence from a start time: travel
// (leg mode by the pace rule), waiting for opening or for a booked slot,
// the visit, the pace's buffer, then back to the stay. Meals are slotted
// into the gap that costs least. `fitDay` orders the day and drops nices
// that no longer fit, each with a plain-English reason; musts stay with a
// warning.
//
// All times are whole local minutes; a leg's seconds round UP to minutes.

import type { DroppedWish, LatLng, PlannedDay, PlannedLeg, PlannedStop } from '../model';
import { dayLabel, fmtMin } from './calendar';
import { mealItem, type DayFrame, type Item, type MealKind } from './items';
import { chooseLeg, legFromPosition, stayPoint, type LegChoice, type SolverContext } from './matrix';
import { orderDay } from './order';

/** Cost weights, in minutes-equivalent. Lower total = better day. */
export const COST = {
  travelPerMin: 1,
  waitPerMin: 1,
  overrunPerMin: 10,
  lateForSlotPerMin: 20,
  cutShortPerMin: 5,
  closedMust: 600,
  closedNice: 300,
  partOfDayMiss: 15,
  partOfDayPerMin: 0.5,
  partOfDayMaxMin: 240,
  droppedNice: 90,
  mustWarning: 60,
};

export type IssueKind = 'closed' | 'cut-short' | 'late-for-slot';

export interface Issue {
  itemId: string;
  kind: IssueKind;
}

export interface Simulation {
  stops: PlannedStop[];
  legs: PlannedLeg[];
  warnings: string[];
  travelMin: number;
  waitMin: number;
  overrunMin: number;
  /** Time back at the stay (or leaving the last stop when there is no stay). */
  endMin: number;
  issues: Issue[];
  cost: number;
}

/** Where the walk starts: either a fresh day or after a kept prefix. */
export interface SimStart {
  /** Stops kept as they are (already timed), and their legs. */
  prefixStops: PlannedStop[];
  prefixLegs: PlannedLeg[];
  /** Point and stop id we leave from; null point = no stay and no prefix. */
  fromPoint: string | null;
  fromStopId: string | null;
  /** Local minute we set off. */
  departMin: number;
  /** Where the phone actually is: the first leg is estimated from here. */
  fromPosition?: LatLng | null;
  /** Fresh day: leave the stay earlier when the first stop is a slot we'd miss. */
  leaveEarlyForSlot?: boolean;
}

const PART_RANGES = {
  morning: [0, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
} as const;

export function stayStartStop(frame: DayFrame, atMin: number): PlannedStop | null {
  if (!frame.stay) return null;
  return {
    id: `stay:${frame.date}:start`,
    kind: 'stay',
    wishId: null,
    title: frame.stay.name,
    location: { ...frame.stay.location },
    arriveMin: atMin,
    departMin: atMin,
    waitSec: 0,
    locked: false,
    bookingId: null,
    warnings: [],
  };
}

/** A fresh-day start: leave the stay at the pace's day start. */
export function freshStart(frame: DayFrame, atMin = frame.dayStartMin, leaveEarlyForSlot = true): SimStart {
  const start = stayStartStop(frame, atMin);
  return {
    prefixStops: start ? [start] : [],
    prefixLegs: [],
    fromPoint: frame.stay ? stayPoint(frame.stay.id) : null,
    fromStopId: start?.id ?? null,
    departMin: atMin,
    leaveEarlyForSlot,
  };
}

function legOf(from: string, to: string, c: LegChoice): PlannedLeg {
  return {
    fromStopId: from,
    toStopId: to,
    mode: c.mode,
    durationSec: c.durationSec,
    distanceM: c.distanceM,
    estimated: c.estimated,
    line: null,
  };
}

const ZERO_LEG: LegChoice = {
  mode: 'walk',
  durationSec: 0,
  distanceM: 0,
  estimated: false,
};

/** Time a sequence forward from a start. Never reorders or drops. */
export function simulate(ctx: SolverContext, frame: DayFrame, start: SimStart, items: Item[]): Simulation {
  const stops = start.prefixStops.map((s) => ({
    ...s,
    warnings: [...s.warnings],
  }));
  const legs = start.prefixLegs.map((l) => ({ ...l }));
  const issues: Issue[] = [];
  let point = start.fromPoint;
  let prevStopId = start.fromStopId;
  let prevLocation: LatLng | null = stops.length ? stops[stops.length - 1].location : null;
  let t = start.departMin;
  let travelMin = 0;
  let waitMin = 0;
  let cost = 0;
  const bufferMin = Math.round(ctx.rules.bufferSec / 60);
  let first = true;

  // A booked first stop we would miss from the normal start: leave earlier.
  const head = items[0];
  const startStop = stops[stops.length - 1];
  if (
    start.leaveEarlyForSlot &&
    head &&
    head.fixedStartMin !== null &&
    head.point !== null &&
    point !== null &&
    startStop?.kind === 'stay'
  ) {
    const legMin = Math.ceil(chooseLeg(ctx, point, head.point).durationSec / 60);
    const latest = head.fixedStartMin - legMin;
    if (latest < t) {
      t = latest;
      startStop.arriveMin = latest;
      startStop.departMin = latest;
    }
  }

  const travel = (to: string | null, toStopId: string): number => {
    if (prevStopId === null) return 0;
    let c: LegChoice;
    if (first && start.fromPosition && to !== null) c = legFromPosition(ctx, start.fromPosition, to);
    else if (point === null || to === null) c = ZERO_LEG;
    else c = chooseLeg(ctx, point, to);
    first = false;
    legs.push(legOf(prevStopId, toStopId, c));
    return Math.ceil(c.durationSec / 60);
  };

  for (const item of items) {
    const target = item.point ?? point;
    const legMin = travel(target, item.id);
    travelMin += legMin;
    const arrive = t + legMin;
    let begin = arrive;
    const warnings = [...item.baseWarnings];
    const what = item.kind === 'meal' ? item.title.toLowerCase() : null;
    if (item.fixedStartMin !== null) {
      if (arrive <= item.fixedStartMin) begin = item.fixedStartMin;
      else {
        warnings.push(`Booked for ${fmtMin(item.fixedStartMin)} — you arrive ${fmtMin(arrive)}`);
        issues.push({ itemId: item.id, kind: 'late-for-slot' });
        cost += (arrive - item.fixedStartMin) * COST.lateForSlotPerMin;
      }
    } else if (item.windows !== null) {
      if (item.windows.length === 0) {
        warnings.push(`Closed on ${dayLabel(frame.date)}`);
        issues.push({ itemId: item.id, kind: 'closed' });
        cost += item.priority === 'must' ? COST.closedMust : COST.closedNice;
      } else {
        const fits = item.windows.find((w) => Math.max(arrive, w.openMin) + item.durationMin <= w.closeMin);
        const open = item.windows.find((w) => Math.max(arrive, w.openMin) < w.closeMin);
        if (fits) begin = Math.max(arrive, fits.openMin);
        else if (open) {
          begin = Math.max(arrive, open.openMin);
          warnings.push(
            what
              ? `Late ${what} — starts ${fmtMin(begin)}`
              : `Closes ${fmtMin(open.closeMin)} — you arrive ${fmtMin(arrive)}`,
          );
          issues.push({ itemId: item.id, kind: 'cut-short' });
          cost += (begin + item.durationMin - open.closeMin) * COST.cutShortPerMin;
        } else {
          const last = item.windows[item.windows.length - 1];
          warnings.push(
            what
              ? `Late ${what} — starts ${fmtMin(begin)}`
              : `Closed by the time you arrive — closes ${fmtMin(last.closeMin)}, you arrive ${fmtMin(arrive)}`,
          );
          issues.push({ itemId: item.id, kind: what ? 'cut-short' : 'closed' });
          cost += what
            ? (begin + item.durationMin - last.closeMin) * COST.cutShortPerMin
            : item.priority === 'must'
              ? COST.closedMust
              : COST.closedNice;
        }
      }
    }
    if (item.partOfDay !== 'any') {
      const [from, to] = PART_RANGES[item.partOfDay];
      // The wanted part of the day works like a soft opening: wait for it
      // (unless the slot is fixed), and pay for starting after it ends.
      if (item.fixedStartMin === null && begin < from && !issues.some((x) => x.itemId === item.id)) {
        const window = item.windows?.find((w) => w.closeMin >= from + item.durationMin && w.openMin <= from);
        if (item.windows === null || window) begin = from;
      }
      const miss = begin < from ? from - begin : begin >= to ? begin - to + 1 : 0;
      if (miss > 0) cost += COST.partOfDayMiss + Math.min(miss, COST.partOfDayMaxMin) * COST.partOfDayPerMin;
    }
    waitMin += begin - arrive;
    const depart = begin + item.durationMin;
    const location = item.location ?? prevLocation;
    stops.push({
      id: item.id,
      kind: item.kind,
      wishId: item.wishId,
      title: item.title,
      location: location ? { ...location } : null,
      arriveMin: arrive,
      departMin: depart,
      waitSec: (begin - arrive) * 60,
      locked: item.locked,
      bookingId: item.bookingId,
      warnings,
    });
    prevStopId = item.id;
    prevLocation = location;
    point = target;
    t = depart + (item.kind === 'meal' ? 0 : bufferMin);
  }

  let endMin = stops.length ? stops[stops.length - 1].departMin : t;
  if (frame.stay) {
    const endId = `stay:${frame.date}:end`;
    const legMin = travel(stayPoint(frame.stay.id), endId);
    travelMin += legMin;
    endMin = t + legMin;
    stops.push({
      id: endId,
      kind: 'stay',
      wishId: null,
      title: frame.stay.name,
      location: { ...frame.stay.location },
      arriveMin: endMin,
      departMin: endMin,
      waitSec: 0,
      locked: false,
      bookingId: null,
      warnings: [],
    });
  }
  const warnings: string[] = [];
  if (!frame.stay) warnings.push('No stay booked for this night');
  const overrunMin = Math.max(0, endMin - frame.dayEndMin);
  if (overrunMin > 0) {
    warnings.push(
      frame.stay
        ? `Back at the stay ${fmtMin(endMin)} — later than ${fmtMin(frame.dayEndMin)}`
        : `Runs to ${fmtMin(endMin)} — later than ${fmtMin(frame.dayEndMin)}`,
    );
  }
  cost += travelMin * COST.travelPerMin + waitMin * COST.waitPerMin + overrunMin * COST.overrunPerMin;
  return {
    stops,
    legs,
    warnings,
    travelMin,
    waitMin,
    overrunMin,
    endMin,
    issues,
    cost,
  };
}

export function toPlannedDay(frame: DayFrame, sim: Simulation): PlannedDay {
  return {
    date: frame.date,
    stayId: frame.stay?.id ?? null,
    stops: sim.stops,
    legs: sim.legs,
    warnings: sim.warnings,
  };
}

/**
 * Insert meals into a sequence at the cheapest gap, one meal at a time
 * (lunch, then dinner), and simulate. Ties go to the earliest gap.
 */
export function withMeals(
  ctx: SolverContext,
  frame: DayFrame,
  start: SimStart,
  seq: Item[],
  meals: Item[],
): { seq: Item[]; sim: Simulation } {
  let current = seq;
  for (const meal of meals) {
    let best: { seq: Item[]; cost: number } | null = null;
    for (let p = 0; p <= current.length; p++) {
      const trial = [...current.slice(0, p), meal, ...current.slice(p)];
      const cost = simulate(ctx, frame, start, trial).cost;
      if (!best || cost < best.cost) best = { seq: trial, cost };
    }
    if (best) current = best.seq;
  }
  return { seq: current, sim: simulate(ctx, frame, start, current) };
}

export function mealsFor(frame: DayFrame, ctx: SolverContext, skip: Set<string> = new Set()): Item[] {
  const kinds: MealKind[] = ['lunch', 'dinner'];
  return kinds
    .map((k) => mealItem(frame.date, k, ctx.rules))
    .filter((m): m is Item => m !== null && !skip.has(m.id));
}

/** Lowest value first: the person's later-listed nices go first, then id. */
export function byLowestValue(a: Item, b: Item): number {
  return b.sortHint - a.sortHint || b.id.localeCompare(a.id);
}

export function droppable(item: Item): boolean {
  return item.kind === 'wish' && item.priority === 'nice' && !item.locked && item.fixedStartMin === null;
}

export interface FitResult {
  day: PlannedDay;
  sim: Simulation;
  /** Wish items that made it, in order (no meals). */
  kept: Item[];
  dropped: DroppedWish[];
}

/**
 * Order a day, slot meals, and drop nices until it fits: first any nice that
 * would be closed when reached, then the lowest-value nice while the day runs
 * past its end. Musts are never dropped.
 */
export function fitDay(
  ctx: SolverContext,
  frame: DayFrame,
  items: Item[],
  start = freshStart(frame),
): FitResult {
  let remaining = [...items];
  const dropped: DroppedWish[] = [];
  for (;;) {
    const meals = remaining.length ? mealsFor(frame, ctx) : [];
    const cost = (seq: Item[]) => withMeals(ctx, frame, start, seq, meals).sim.cost;
    const ordered = orderDay(remaining, cost);
    const { sim } = withMeals(ctx, frame, start, ordered, meals);
    const closedNices = remaining
      .filter((i) => droppable(i) && sim.issues.some((x) => x.itemId === i.id && x.kind === 'closed'))
      .sort(byLowestValue);
    let victim: Item | undefined;
    let reason = '';
    if (closedNices.length) {
      victim = closedNices[0];
      reason =
        victim.windows?.length === 0
          ? `Closed on ${dayLabel(frame.date)}`
          : `Closed by the time you'd get there on ${dayLabel(frame.date)}`;
    } else if (sim.overrunMin > 0) {
      victim = remaining.filter(droppable).sort(byLowestValue)[0];
      reason = `No time on ${dayLabel(frame.date)} — the day would end at ${fmtMin(sim.endMin)}, after ${fmtMin(frame.dayEndMin)}`;
    }
    if (!victim) {
      return { day: toPlannedDay(frame, sim), sim, kept: ordered, dropped };
    }
    const gone = victim;
    dropped.push({ wishId: gone.wishId ?? gone.id, reason });
    remaining = remaining.filter((i) => i !== gone);
  }
}
