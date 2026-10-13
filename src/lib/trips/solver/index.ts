// src/lib/trips/solver/index.ts
//
// The deterministic trip solver: same input, same plan. No I/O, no clock,
// no randomness; ties break on ids. Contract:
// docs/superpowers/specs/2026-10-13-trips.md ("Solver API").

import type { DroppedWish, LocalDate, PlannedDay, ReplanOption, SolvedPlan, Stay, Wish } from '../model';
import { datesBetween, dayLabel, cmp } from './calendar';
import { assignDays } from './days';
import { closedOn } from './hours';
import { wishItem, type DayFrame, type Item } from './items';
import { makeContext } from './matrix';
import { COST, fitDay, type FitResult } from './timing';
import { replanDay as replanDayImpl, retimeDay as retimeDayImpl } from './replan';
import type { ReplanInput, RetimeInput, SolverInput } from './types';

export type { SolverInput, ReplanInput, RetimeInput } from './types';

/** The stay for a night: the stay covering it, else the one checking out that morning. */
export function stayFor(stays: Stay[], date: LocalDate): Stay | null {
  const sorted = [...stays].sort((a, b) => cmp(a.fromDate, b.fromDate) || cmp(a.id, b.id));
  return (
    sorted.find((s) => s.fromDate <= date && date < s.toDate) ?? sorted.find((s) => s.toDate === date) ?? null
  );
}

/** Plan the whole trip. */
export function solveTrip(input: SolverInput): SolvedPlan {
  const { trip, stays, wishes, bookings, matrix } = input;
  const ctx = makeContext(trip, stays, wishes, matrix);
  const frames: DayFrame[] = datesBetween(trip.startDate, trip.endDate).map((date) => ({
    date,
    stay: stayFor(stays, date),
    dayStartMin: ctx.rules.dayStartMin,
    dayEndMin: ctx.rules.dayEndMin,
  }));
  const assignment = assignDays(ctx, frames, wishes, bookings);
  const warnings = [...assignment.warnings];

  const items = new Map<LocalDate, Item[]>();
  const fits = new Map<LocalDate, FitResult>();
  const dropReasons = new Map<string, { reason: string; date: LocalDate }>();
  for (const frame of frames) {
    const list = (assignment.byDate.get(frame.date) ?? []).map((w) => wishItem(w, frame.date, bookings));
    const fit = fitDay(ctx, frame, list);
    for (const d of fit.dropped) dropReasons.set(d.wishId, { reason: d.reason, date: frame.date });
    items.set(
      frame.date,
      list.filter((i) => !fit.dropped.some((d) => d.wishId === i.wishId)),
    );
    fits.set(frame.date, fit);
  }

  // Second chance: a nice dropped from a full day may fit on another day.
  const byId = new Map(wishes.map((w) => [w.id, w]));
  const retry = [...dropReasons.keys()]
    .map((id) => byId.get(id))
    .filter((w): w is Wish => w !== undefined)
    .sort((a, b) => a.sortHint - b.sortHint || cmp(a.id, b.id));
  for (const wish of retry) {
    const from = dropReasons.get(wish.id)?.date;
    for (const frame of frames) {
      if (frame.date === from || closedOn(wish.facts, frame.date)) continue;
      const before = fits.get(frame.date) as FitResult;
      const list = [...(items.get(frame.date) ?? []), wishItem(wish, frame.date, bookings)];
      const trial = fitDay(ctx, frame, list);
      if (
        trial.dropped.length === 0 &&
        trial.sim.overrunMin <= before.sim.overrunMin &&
        trial.sim.issues.length <= before.sim.issues.length
      ) {
        items.set(frame.date, list);
        fits.set(frame.date, trial);
        dropReasons.delete(wish.id);
        break;
      }
    }
  }

  const dropped: DroppedWish[] = [...assignment.dropped];
  for (const [wishId, { reason }] of dropReasons) {
    dropped.push({
      wishId,
      reason: frames.length > 1 ? `${reason}; no other day had room` : reason,
    });
  }

  for (const b of bookings) {
    if (b.status !== 'booked' || b.wishId !== null || !b.date) continue;
    if (frames.some((f) => f.date === b.date)) {
      warnings.push(
        `${b.title} on ${dayLabel(b.date)} is booked but not linked to a wish, so it isn't in the plan`,
      );
    }
  }

  const days = frames.map((f) => (fits.get(f.date) as FitResult).day);
  let score = 0;
  for (const f of frames) {
    const fit = fits.get(f.date) as FitResult;
    score += fit.sim.travelMin + fit.sim.waitMin + fit.sim.overrunMin * COST.overrunPerMin;
    const mustIssues = new Set(
      fit.sim.issues
        .filter((x) => fit.kept.some((k) => k.id === x.itemId && k.priority === 'must'))
        .map((x) => x.itemId),
    );
    score += mustIssues.size * COST.mustWarning;
  }
  for (const d of dropped) {
    score += byId.get(d.wishId)?.priority === 'must' ? COST.mustWarning : COST.droppedNice;
  }
  return { days, dropped, warnings, score };
}

/** Up to three ways to carry on from now, best first. */
export function replanDay(input: ReplanInput): ReplanOption[] {
  return replanDayImpl(input);
}

/** Re-time a day from `fromIndex`, setting off towards that stop at `startMin`. */
export function retimeDay(
  day: PlannedDay,
  fromIndex: number,
  startMin: number,
  input: RetimeInput,
): PlannedDay {
  return retimeDayImpl(day, fromIndex, startMin, input);
}

export { estimateMatrix, estimateLeg, haversineM } from './estimate';
export { parseOpeningHours, windowsOn } from './hours';
export { sliceMatrix } from './matrix';
export { isoWeekday, dayLabel, fmtMin } from './calendar';
