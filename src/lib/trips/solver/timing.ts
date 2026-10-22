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
import { dayLabel, fmtMin, cmp } from './calendar';
import { mealItem, type DayFrame, type Item, type MealKind } from './items';
import { STAY_HANDLING_MIN } from './transport';
import { BREAKFAST } from './rules';
import { mealOfStop, withStages } from './stages';
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
  /** v4: when the last sightseeing stop (not a meal or evening wish) ends. */
  lastActiveMin: number;
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

/**
 * A fresh-day start: leave the stay at the pace's day start. On an arrival
 * day (v3) the day starts at the landing instead: transport stop, transfer,
 * bag drop or check-in, then set off at `frame.dayStartMin` (or `atMin` if
 * later). On a departure day a "Check out" stop follows the stay start.
 */
function breakfastWarnings(atMin: number): string[] {
  return atMin < BREAKFAST.fromMin ? [`Early breakfast at ${fmtMin(atMin)}`] : [];
}

/** A start without the at-stay breakfast (a café wish replaces it); leaving time unchanged. */
export function withoutBreakfast(start: SimStart): SimStart {
  const i = start.prefixStops.findIndex((s) => s.kind === 'meal' && s.id.endsWith(':breakfast'));
  if (i < 0) return start;
  const prefixStops = start.prefixStops.filter((_, k) => k !== i);
  const prefixLegs = start.prefixLegs
    .filter((l) => l.toStopId !== start.prefixStops[i].id)
    .map((l) => (l.fromStopId === start.prefixStops[i].id ? { ...l, fromStopId: prefixStops[i - 1].id } : l));
  const last = prefixStops[prefixStops.length - 1];
  return { ...start, prefixStops, prefixLegs, fromStopId: last ? last.id : null };
}

export function freshStart(frame: DayFrame, atMin = frame.dayStartMin, leaveEarlyForSlot = true): SimStart {
  if (frame.arrival && frame.stay) {
    const a = frame.arrival;
    return {
      prefixStops: [
        { ...a.stop, warnings: [...a.stop.warnings] },
        { ...a.stayStop, warnings: [...a.stayStop.warnings] },
      ],
      prefixLegs: [{ ...a.leg }],
      fromPoint: stayPoint(frame.stay.id),
      fromStopId: a.stayStop.id,
      departMin: Math.max(atMin, frame.dayStartMin),
    };
  }
  // v4: breakfast at the stay just before setting off at `atMin`.
  const bf = Math.round(BREAKFAST.durationSec / 60);
  const start = stayStartStop(frame, frame.stay ? atMin - bf : atMin);
  if (start && frame.stay) {
    const breakfast: PlannedStop = {
      id: `meal:${frame.date}:breakfast`,
      kind: 'meal',
      wishId: null,
      title: 'Breakfast',
      location: { ...frame.stay.location },
      arriveMin: atMin - bf,
      departMin: atMin,
      waitSec: 0,
      locked: false,
      bookingId: null,
      warnings: breakfastWarnings(atMin - bf),
    };
    const prefixStops: PlannedStop[] = [start, breakfast];
    const prefixLegs: PlannedLeg[] = [legOf(start.id, breakfast.id, ZERO_LEG)];
    if (frame.departure?.checkOut) {
      const by = frame.stay.checkOutMin as number;
      const checkOut: PlannedStop = {
        id: `stay:${frame.date}:checkout`,
        kind: 'stay',
        wishId: null,
        title: `Check out of ${frame.stay.name}`,
        location: { ...frame.stay.location },
        arriveMin: atMin,
        departMin: atMin + STAY_HANDLING_MIN,
        waitSec: 0,
        locked: false,
        bookingId: null,
        warnings: atMin + STAY_HANDLING_MIN > by ? [`Check-out is by ${fmtMin(by)}`] : [],
      };
      prefixLegs.push(legOf(breakfast.id, checkOut.id, ZERO_LEG));
      prefixStops.push(checkOut);
    }
    const last = prefixStops[prefixStops.length - 1];
    return {
      prefixStops,
      prefixLegs,
      fromPoint: stayPoint(frame.stay.id),
      fromStopId: last.id,
      departMin: last.departMin,
      leaveEarlyForSlot,
    };
  }
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

/** Dinner moves near the stay when it would otherwise mean waiting longer than this. */
export const DINNER_NEAR_STAY_AFTER_MIN = 60;

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
  let restMin = 0;
  let cost = 0;
  const bufferMin = Math.round(ctx.rules.bufferSec / 60);
  let first = true;

  // A booked first stop we would miss from the normal start: leave earlier
  // (the whole opening — stay start, breakfast, check-out — moves with it).
  const head = items[0];
  if (
    start.leaveEarlyForSlot &&
    head &&
    head.fixedStartMin !== null &&
    head.point !== null &&
    point !== null &&
    stops[0]?.kind === 'stay' &&
    stops[0].id.endsWith(':start')
  ) {
    const legMin = Math.ceil(chooseLeg(ctx, point, head.point).durationSec / 60);
    const latest = head.fixedStartMin - legMin;
    if (latest < t) {
      const shift = latest - t;
      t = latest;
      for (const s of stops) {
        s.arriveMin += shift;
        s.departMin += shift;
        if (s.kind === 'meal' && s.id.endsWith(':breakfast')) s.warnings = breakfastWarnings(s.arriveMin);
      }
    }
  }

  const travel = (to: string | null, toStopId: string): number => {
    if (prevStopId === null) return 0;
    let c: LegChoice;
    if (first && start.fromPosition && to !== null) c = legFromPosition(ctx, start.fromPosition, to);
    else if (to === null) c = ZERO_LEG;
    else if (point === null) c = prevLocation ? legFromPosition(ctx, prevLocation, to) : ZERO_LEG;
    else c = chooseLeg(ctx, point, to);
    first = false;
    legs.push(legOf(prevStopId, toStopId, c));
    return Math.ceil(c.durationSec / 60);
  };

  for (const item of items) {
    // v4: with a long gap before dinner, have it near the stay (go back,
    // rest, eat nearby) rather than wait where the last sight was.
    const dinnerAtStay =
      item.kind === 'meal' &&
      item.id.endsWith(':dinner') &&
      frame.stay !== null &&
      item.windows !== null &&
      item.windows.length > 0 &&
      item.windows[0].openMin - t > DINNER_NEAR_STAY_AFTER_MIN;
    const target = dinnerAtStay && frame.stay ? stayPoint(frame.stay.id) : (item.point ?? point);
    let arrive: number;
    if (dinnerAtStay && frame.stay && item.windows) {
      // Back to the stay for free time, then dinner nearby when it opens.
      const restId = `stay:${frame.date}:rest`;
      const legMin = travel(target, restId);
      travelMin += legMin;
      const atStay = t + legMin;
      const open = item.windows[0].openMin;
      stops.push({
        id: restId,
        kind: 'stay',
        wishId: null,
        title: `Free time at ${frame.stay.name}`,
        location: { ...frame.stay.location },
        arriveMin: atStay,
        departMin: Math.max(atStay, open),
        waitSec: 0,
        locked: false,
        bookingId: null,
        warnings: [],
      });
      restMin += Math.max(0, open - atStay);
      legs.push(legOf(restId, item.id, ZERO_LEG));
      prevStopId = restId;
      arrive = Math.max(atStay, open);
    } else {
      const legMin = travel(target, item.id);
      travelMin += legMin;
      // A slot hours away while still at the stay (an idea on an otherwise
      // free day): stay put until it is time to go, rather than wait there.
      if (item.fixedStartMin !== null && frame.stay && point === stayPoint(frame.stay.id) && item.fixedStartMin - legMin - t > DINNER_NEAR_STAY_AFTER_MIN) {
        t = item.fixedStartMin - legMin;
      }
      arrive = t + legMin;
    }
    let begin = arrive;
    const warnings = [...item.baseWarnings];
    const what = item.kind === 'meal' ? item.title.toLowerCase() : item.replacesMeal;
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
    waitMin += Math.max(0, begin - arrive);
    // Free time before dinner is the evening's rest, not a wasted wait.
    if (item.kind === 'meal' && item.id.endsWith(':dinner')) restMin += Math.max(0, begin - arrive);
    // Re-planning holds a locked stop's planned times: the slot never moves,
    // and lateness shows only as the "Booked for … — you arrive …" warning.
    const held = item.heldArriveMin !== null && item.fixedStartMin !== null;
    if (held) begin = item.fixedStartMin as number;
    const shownArrive = held ? (item.heldArriveMin as number) : arrive;
    // A locked stop being re-timed keeps its planned end, even when late.
    const depart = item.fixedEndMin !== null ? Math.max(item.fixedEndMin, begin) : begin + item.durationMin;
    const location = dinnerAtStay && frame.stay ? frame.stay.location : (item.location ?? prevLocation);
    stops.push({
      id: item.id,
      kind: item.kind,
      wishId: item.wishId,
      title: item.title,
      location: location ? { ...location } : null,
      arriveMin: shownArrive,
      departMin: depart,
      waitSec: (begin - shownArrive) * 60,
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
    const dep = frame.departure;
    stops.push({
      id: endId,
      kind: 'stay',
      wishId: null,
      title: dep ? `Collect bags at ${frame.stay.name}` : frame.stay.name,
      location: { ...frame.stay.location },
      arriveMin: endMin,
      departMin: dep ? Math.max(endMin + STAY_HANDLING_MIN, dep.leaveMin) : endMin,
      waitSec: 0,
      locked: false,
      bookingId: null,
      warnings: [],
    });
  }
  const warnings: string[] = [];
  if (frame.departure && frame.stay) {
    // v3: then off to the station/airport.
    const dep = frame.departure;
    const from = stops[stops.length - 1];
    legs.push(legOf(from.id, dep.stop.id, dep.leg));
    const reach = from.departMin + Math.ceil(dep.leg.durationSec / 60);
    stops.push({
      ...dep.stop,
      arriveMin: reach,
      warnings: [],
    });
    if (reach > dep.stop.arriveMin) {
      warnings.push(
        `You'd reach ${dep.stop.title.includes(' from ') ? dep.stop.title.split(' from ')[1].split(' at ')[0] : 'the terminal'} at ${fmtMin(reach)} — later than ${fmtMin(dep.stop.arriveMin)}`,
      );
    }
  }
  if (!frame.stay) warnings.push('No stay booked for this night');
  const endOverrun = Math.max(0, endMin - frame.dayEndMin);
  if (endOverrun > 0) {
    warnings.push(
      frame.stay
        ? `Back at the stay ${fmtMin(endMin)} — later than ${fmtMin(frame.dayEndMin)}`
        : `Runs to ${fmtMin(endMin)} — later than ${fmtMin(frame.dayEndMin)}`,
    );
  }
  // v4: sightseeing (not meals, not evening wishes) should end by the
  // active end; dinner and the evening run on to the day's end.
  const activeIds = new Set(
    items.filter((i) => i.kind === 'wish' && i.partOfDay !== 'evening' && !i.replacesMeal).map((i) => i.id),
  );
  const lastActive = stops.reduce((m, s) => (activeIds.has(s.id) ? Math.max(m, s.departMin) : m), 0);
  const activeEnd = frame.activeEndMin ?? frame.dayEndMin;
  const activeOverrun = Math.max(0, lastActive - activeEnd);
  if (activeOverrun > 0 && endOverrun === 0) {
    warnings.push(`Sightseeing runs to ${fmtMin(lastActive)} — later than ${fmtMin(activeEnd)}`);
  }
  const overrunMin = Math.max(endOverrun, activeOverrun);
  cost +=
    travelMin * COST.travelPerMin + (waitMin - restMin) * COST.waitPerMin + overrunMin * COST.overrunPerMin;
  return {
    stops: withStages(stops, (s) => mealOfStop(s, ctx.replaces)),
    legs,
    warnings,
    travelMin,
    waitMin,
    overrunMin,
    endMin,
    lastActiveMin: lastActive,
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

/**
 * The meals to slot into a day. Breakfast is normally part of the day's
 * opening at the stay; on an arrival day it is a meal to slot only when the
 * day starts (bags dropped) early enough to still start it in its window.
 * A meal whose window ends before the day starts, or starts after the day
 * ends (a departure day), is left out.
 */
export function mealsFor(frame: DayFrame, ctx: SolverContext, skip: Set<string> = new Set()): Item[] {
  const kinds: MealKind[] = frame.arrival ? ['breakfast', 'lunch', 'dinner'] : ['lunch', 'dinner'];
  return kinds
    .map((k) => mealItem(frame.date, k, ctx.rules))
    .filter((m): m is Item => {
      if (m === null || skip.has(m.id)) return false;
      const w = m.windows?.[0];
      if (!w) return true;
      return w.closeMin - m.durationMin >= frame.dayStartMin && w.openMin < frame.dayEndMin;
    });
}

/** Lowest value first: the person's later-listed nices go first, then id. */
export function byLowestValue(a: Item, b: Item): number {
  return b.sortHint - a.sortHint || cmp(b.id, a.id);
}

/**
 * Drop order: unpinned before pinned (a wish pinned to the day — fixed date,
 * fixed time or booked — outranks unpinned ones), then lowest value.
 */
export function byDropOrder(a: Item, b: Item): number {
  return (a.pinned ? 1 : 0) - (b.pinned ? 1 : 0) || byLowestValue(a, b);
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
 * Order a day, slot meals, and drop nices until it fits (no nice closed when
 * reached, no booked slot missed, back by the day's end). Unpinned nices go
 * first — closed-on-arrival ones, then lowest value; a nice pinned to the day
 * is only dropped when no unpinned nice is left. Musts are never dropped.
 */
export function fitDay(
  ctx: SolverContext,
  frame: DayFrame,
  items: Item[],
  start = freshStart(frame),
  skipMeals: Set<string> = new Set(),
): FitResult {
  let remaining = [...items];
  const dropped: DroppedWish[] = [];
  for (;;) {
    // A wish that replaces a meal takes that meal's place.
    const skip = new Set(skipMeals);
    for (const i of remaining) if (i.replacesMeal) skip.add(`meal:${frame.date}:${i.replacesMeal}`);
    const meals = remaining.length ? mealsFor(frame, ctx, skip) : [];
    // A café wish that replaces breakfast: no breakfast at the stay.
    const dayStart = remaining.some((i) => i.replacesMeal === 'breakfast') ? withoutBreakfast(start) : start;
    const cost = (seq: Item[]) => withMeals(ctx, frame, dayStart, seq, meals).sim.cost;
    const ordered = orderDay(remaining, cost);
    const { sim } = withMeals(ctx, frame, dayStart, ordered, meals);
    const closedNices = remaining
      .filter((i) => droppable(i) && sim.issues.some((x) => x.itemId === i.id && x.kind === 'closed'))
      .sort(byDropOrder);
    const lateSlot = sim.issues.some((x) => x.kind === 'late-for-slot');
    let victim: Item | undefined;
    let reason = '';
    if (closedNices.length || sim.overrunMin > 0 || lateSlot) {
      const unpinned = remaining.filter((i) => droppable(i) && !i.pinned).sort(byLowestValue);
      const closedUnpinned = closedNices.find((i) => !i.pinned);
      victim =
        closedNices.find((i) => i.windows?.length === 0) ??
        closedUnpinned ??
        (closedNices.length && !unpinned.length ? closedNices[0] : undefined) ??
        unpinned[0] ??
        remaining.filter(droppable).sort(byDropOrder)[0];
      if (victim && closedNices.includes(victim)) {
        reason =
          victim.windows?.length === 0
            ? `Closed on ${dayLabel(frame.date)}`
            : `Closed by the time you'd get there on ${dayLabel(frame.date)}`;
      } else if (sim.overrunMin > 0) {
        reason =
          sim.endMin > frame.dayEndMin
            ? `No time on ${dayLabel(frame.date)} — the day would end at ${fmtMin(sim.endMin)}, after ${fmtMin(frame.dayEndMin)}`
            : `No time on ${dayLabel(frame.date)} — sightseeing would run to ${fmtMin(sim.lastActiveMin)}, after ${fmtMin(frame.activeEndMin ?? frame.dayEndMin)}`;
      } else if (closedNices.length) {
        reason = `Made room on ${dayLabel(frame.date)} for ${closedNices[0].title}, which is planned for that day`;
      } else {
        reason = `No time on ${dayLabel(frame.date)} before a booked slot`;
      }
    }
    if (!victim) {
      return { day: toPlannedDay(frame, sim), sim, kept: ordered, dropped };
    }
    const gone = victim;
    dropped.push({ wishId: gone.wishId ?? gone.id, reason });
    remaining = remaining.filter((i) => i !== gone);
  }
}
