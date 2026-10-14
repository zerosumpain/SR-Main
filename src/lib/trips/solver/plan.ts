// src/lib/trips/solver/plan.ts
//
// Solving a run of days: split wishes across them, fit each day, give
// dropped nices a second chance on another day. `solveTrip` runs it over the
// whole trip from fresh mornings; `replanTrip` runs it from "now" today
// (today's frame starts where the person is) over the remaining days, with
// locked stops held at their planned times.

import type {
  Booking,
  DroppedWish,
  LocalDate,
  PlannedDay,
  PlannedStop,
  SolvedPlan,
  Stay,
  Trip,
  Wish,
} from '../model';
import { cmp, datesBetween, dayLabel } from './calendar';
import { assignDays } from './days';
import { closedOn } from './hours';
import { dayFrame, pinnedDate, wishItem, type DayFrame, type Item } from './items';
import { makeContext, type SolverContext } from './matrix';
import type { SolverInput } from './types';
import { COST, byLowestValue, fitDay, freshStart, type FitResult, type SimStart } from './timing';

/** The stay for a night: the stay covering it, else the one checking out that morning. */
export function stayFor(stays: Stay[], date: LocalDate): Stay | null {
  const sorted = [...stays].sort((a, b) => cmp(a.fromDate, b.fromDate) || cmp(a.id, b.id));
  return (
    sorted.find((s) => s.fromDate <= date && date < s.toDate) ?? sorted.find((s) => s.toDate === date) ?? null
  );
}

export function makeFrames(
  ctx: SolverContext,
  trip: Pick<Trip, 'startDate' | 'endDate'>,
  stays: Stay[],
  from: LocalDate = trip.startDate,
): DayFrame[] {
  return datesBetween(from > trip.startDate ? from : trip.startDate, trip.endDate).map((date) =>
    dayFrame(ctx.rules, ctx.dayLoads, date, stayFor(stays, date)),
  );
}

/** One day to solve: its frame, where it starts, meals already had, locked stops to hold. */
export interface FrameSpec {
  frame: DayFrame;
  start: SimStart;
  skipMeals: Set<string>;
  /** Locked stops of the current plan on this date, by wish id: kept at their planned times. */
  held: Map<string, PlannedStop>;
}

export function freshSpec(frame: DayFrame, held: Map<string, PlannedStop> = new Map()): FrameSpec {
  return { frame, start: freshStart(frame), skipMeals: new Set(), held };
}

/** A locked item keeps the planned times of its stop in the current plan. */
export function holdItem(item: Item, held: PlannedStop | undefined): Item {
  if (!held || !item.locked || !held.locked) return item;
  const startMin = held.arriveMin + Math.round(held.waitSec / 60);
  return {
    ...item,
    fixedStartMin: startMin,
    fixedEndMin: held.departMin,
    heldArriveMin: held.arriveMin,
    durationMin: Math.max(0, held.departMin - startMin),
  };
}

export interface SolvedFrames {
  days: PlannedDay[];
  fits: Map<LocalDate, FitResult>;
  items: Map<LocalDate, Item[]>;
  dropped: DroppedWish[];
  warnings: string[];
  score: number;
}

export function solveFrames(
  ctx: SolverContext,
  specs: FrameSpec[],
  wishes: Wish[],
  bookings: Booking[],
  opts: { shedMustsFromFirst?: boolean } = {},
): SolvedFrames {
  const frames = specs.map((s) => s.frame);
  const assignment = assignDays(ctx, frames, wishes, bookings);
  const itemFor = (spec: FrameSpec, wish: Wish) =>
    holdItem(wishItem(wish, spec.frame.date, bookings, ctx.rules), spec.held.get(wish.id));
  const fit = (spec: FrameSpec, list: Item[]) => fitDay(ctx, spec.frame, list, spec.start, spec.skipMeals);

  const items = new Map<LocalDate, Item[]>();
  const fits = new Map<LocalDate, FitResult>();
  const dropReasons = new Map<string, { reason: string; date: LocalDate }>();
  for (const spec of specs) {
    const list = (assignment.byDate.get(spec.frame.date) ?? []).map((w) => itemFor(spec, w));
    const f = fit(spec, list);
    for (const d of f.dropped) dropReasons.set(d.wishId, { reason: d.reason, date: spec.frame.date });
    items.set(
      spec.frame.date,
      list.filter((i) => !f.dropped.some((d) => d.wishId === i.wishId)),
    );
    fits.set(spec.frame.date, f);
  }

  // Second chance: a nice dropped from a full day may fit on another day.
  const byId = new Map(wishes.map((w) => [w.id, w]));
  const tryOn = (wish: Wish, skip: LocalDate | undefined, needNoOverrun: boolean): boolean => {
    for (const spec of specs) {
      const date = spec.frame.date;
      // Never pile onto a light day.
      if (date === skip || spec.frame.load === 'light' || closedOn(wish.facts, date)) continue;
      const before = fits.get(date) as FitResult;
      const list = [...(items.get(date) ?? []), itemFor(spec, wish)];
      const trial = fit(spec, list);
      if (
        trial.dropped.length === 0 &&
        trial.sim.overrunMin <= (needNoOverrun ? 0 : before.sim.overrunMin) &&
        trial.sim.issues.length <= before.sim.issues.length
      ) {
        items.set(date, list);
        fits.set(date, trial);
        return true;
      }
    }
    return false;
  };
  const retry = [...dropReasons.keys()]
    .map((id) => byId.get(id))
    .filter((w): w is Wish => w !== undefined)
    .sort((a, b) => a.sortHint - b.sortHint || cmp(a.id, b.id));
  for (const wish of retry) {
    if (tryOn(wish, dropReasons.get(wish.id)?.date, false)) dropReasons.delete(wish.id);
  }

  // A must that no longer works on its day (closed by the time we'd get
  // there, cut short, or the day overruns) moves to the other day where it
  // does least harm — nices there may be dropped for it. Applies to today
  // when re-planning from now, and to every light day.
  const mustIssues = (f: FitResult) =>
    f.sim.issues.filter((x) => f.kept.some((k) => k.id === x.itemId && k.priority === 'must')).length;
  const shed = (source: FrameSpec) => {
    const date = source.frame.date;
    const targets = specs.filter(
      (s, i) => s !== source && s.frame.load !== 'light' && !(opts.shedMustsFromFirst && i === 0),
    );
    for (let guard = 0; guard < 20; guard++) {
      const f = fits.get(date) as FitResult;
      const movable = (items.get(date) ?? []).filter((i) => {
        const wish = i.wishId ? byId.get(i.wishId) : undefined;
        return (
          wish &&
          i.priority === 'must' &&
          !i.locked &&
          i.fixedStartMin === null &&
          pinnedDate(wish, bookings) !== date
        );
      });
      const troubled = movable
        .filter((i) => f.sim.issues.some((x) => x.itemId === i.id && x.kind !== 'late-for-slot'))
        .sort(byLowestValue);
      const candidate =
        troubled[0] ?? (f.sim.overrunMin > 0 ? [...movable].sort(byLowestValue)[0] : undefined);
      const wish = candidate?.wishId ? byId.get(candidate.wishId) : undefined;
      if (!candidate || !wish) break;
      let best: { spec: FrameSpec; trial: FitResult; list: Item[]; harm: number } | null = null;
      for (const spec of targets) {
        const d = spec.frame.date;
        if (closedOn(wish.facts, d)) continue;
        const before = fits.get(d) as FitResult;
        const list = [...(items.get(d) ?? []), itemFor(spec, wish)];
        const trial = fit(spec, list);
        if (mustIssues(trial) > mustIssues(before) || trial.sim.overrunMin > before.sim.overrunMin) continue;
        const harm = trial.dropped.length * COST.droppedNice + (trial.sim.cost - before.sim.cost);
        if (!best || harm < best.harm) best = { spec, trial, list, harm };
      }
      if (!best) break;
      const d = best.spec.frame.date;
      for (const x of best.trial.dropped) dropReasons.set(x.wishId, { reason: x.reason, date: d });
      items.set(
        d,
        best.list.filter((i) => !best.trial.dropped.some((x) => x.wishId === i.wishId)),
      );
      fits.set(d, best.trial);
      const rest = (items.get(date) ?? []).filter((i) => i !== candidate);
      items.set(date, rest);
      fits.set(date, fit(source, rest));
    }
  };
  if (opts.shedMustsFromFirst && specs.length > 1) shed(specs[0]);
  for (const spec of specs) if (spec.frame.load === 'light') shed(spec);

  const dropped: DroppedWish[] = [...assignment.dropped];
  for (const [wishId, { reason }] of dropReasons) {
    dropped.push({
      wishId,
      reason: frames.length > 1 ? `${reason}; no other day had room` : reason,
    });
  }

  let score = 0;
  for (const spec of specs) {
    const f = fits.get(spec.frame.date) as FitResult;
    score += f.sim.travelMin + f.sim.waitMin + f.sim.overrunMin * COST.overrunPerMin;
    const mustIssues = new Set(
      f.sim.issues
        .filter((x) => f.kept.some((k) => k.id === x.itemId && k.priority === 'must'))
        .map((x) => x.itemId),
    );
    score += mustIssues.size * COST.mustWarning;
  }
  for (const d of dropped) {
    score += byId.get(d.wishId)?.priority === 'must' ? COST.mustWarning : COST.droppedNice;
  }
  return {
    days: specs.map((s) => (fits.get(s.frame.date) as FitResult).day),
    fits,
    items,
    dropped,
    warnings: [...assignment.warnings],
    score,
  };
}

/** Plan the whole trip. */
export function solveTrip(input: SolverInput): SolvedPlan {
  const { trip, stays, wishes, bookings, matrix } = input;
  const ctx = makeContext(trip, stays, wishes, matrix);
  const specs = makeFrames(ctx, trip, stays).map((frame) => freshSpec(frame));
  const solved = solveFrames(ctx, specs, wishes, bookings);
  const warnings = [...solved.warnings];
  for (const b of bookings) {
    if (b.status !== 'booked' || b.wishId !== null || !b.date) continue;
    if (specs.some((f) => f.frame.date === b.date)) {
      warnings.push(
        `${b.title} on ${dayLabel(b.date)} is booked but not linked to a wish, so it isn't in the plan`,
      );
    }
  }
  return { days: solved.days, dropped: solved.dropped, warnings, score: solved.score };
}
