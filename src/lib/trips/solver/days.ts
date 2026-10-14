// src/lib/trips/solver/days.ts
//
// Split wishes across the trip's days. Pinned wishes (a booked slot or a
// fixed date) go to their day first. The rest are placed one at a time —
// musts before nices, the hardest to place first (fewest open days, then
// longest) — on the day where they cost least:
//   closeness: travel to the nearest thing already on that day, or the stay
//   balance:   the marginal squared load against the pace's usable day
//   part of day: a soft cost when the place isn't open in the wanted part
// Days a place is closed are never chosen; a must closed on every day still
// goes on its cheapest day and carries a warning.

import type { Booking, DroppedWish, LocalDate, Wish } from '../model';
import { dayLabel, cmp } from './calendar';
import { windowsOn } from './hours';
import {
  FULL_DAY_SHARE,
  LIGHT_DAY_SHARE,
  bookedSlot,
  pinnedDate,
  visitMin,
  wishWindows,
  type DayFrame,
} from './items';
import { chooseLeg, stayPoint, type SolverContext } from './matrix';

const BALANCE_WEIGHT = 90;
const PART_OF_DAY_MISS = 30;
const OVERLOAD_PER_MIN = 2;

const PART_RANGES = {
  morning: [0, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
} as const;

export interface DayAssignment {
  byDate: Map<LocalDate, Wish[]>;
  dropped: DroppedWish[];
  warnings: string[];
}

/**
 * Minutes of sights a day should take. Normal: the day less its meals. A
 * light day: LIGHT_DAY_SHARE of the pace's normal active time (and never more
 * than is left before its earlier end); a full day: FULL_DAY_SHARE.
 */
export function capacityMin(ctx: SolverContext, frame: DayFrame): number {
  const meals =
    Math.round(ctx.rules.lunch.durationSec / 60) +
    (ctx.rules.dinner ? Math.round(ctx.rules.dinner.durationSec / 60) : 0);
  const left = frame.dayEndMin - frame.dayStartMin - meals;
  const normal = ctx.rules.dayEndMin - ctx.rules.dayStartMin - meals;
  if (frame.load === 'light') return Math.max(30, Math.min(left, Math.round(normal * LIGHT_DAY_SHARE)));
  if (frame.load === 'full') return Math.max(60, Math.round(left * FULL_DAY_SHARE));
  return Math.max(60, left);
}

function travelMin(ctx: SolverContext, a: string, b: string): number {
  return chooseLeg(ctx, a, b).durationSec / 60;
}

function openInPart(wish: Wish, date: LocalDate): boolean {
  if (wish.partOfDay === 'any') return true;
  const windows = windowsOn(wish.facts, date);
  if (windows === null) return true;
  const [from, to] = PART_RANGES[wish.partOfDay];
  return windows.some((w) => w.openMin < to && w.closeMin > from);
}

/** Minutes a wish adds to a day; a meal-replacing wish only adds what runs past the meal. */
function sightMin(wish: Wish, slot: Booking | null, ctx?: SolverContext): number {
  const visit = visitMin(wish, slot);
  if (!wish.replacesMeal || !ctx) return visit;
  const meal = wish.replacesMeal === 'lunch' ? ctx.rules.lunch : ctx.rules.dinner;
  return Math.max(0, visit - (meal ? Math.round(meal.durationSec / 60) : 0));
}

/** Assign every plannable wish to a day. */
export function assignDays(
  ctx: SolverContext,
  frames: DayFrame[],
  wishes: Wish[],
  bookings: Booking[],
): DayAssignment {
  const byDate = new Map<LocalDate, Wish[]>(frames.map((f) => [f.date, []]));
  const load = new Map<LocalDate, number>(frames.map((f) => [f.date, 0]));
  const dropped: DroppedWish[] = [];
  const warnings: string[] = [];
  const bufferMin = ctx.rules.bufferSec / 60;
  const stayKey = (f: DayFrame) => (f.stay ? stayPoint(f.stay.id) : null);

  const nearest = (wish: Wish, frame: DayFrame): number => {
    const others = (byDate.get(frame.date) ?? []).map((w) => w.id);
    const s = stayKey(frame);
    if (s) others.push(s);
    if (!others.length) return 0;
    return Math.min(...others.map((o) => travelMin(ctx, o, wish.id)));
  };
  const add = (wish: Wish, frame: DayFrame) => {
    const extra = sightMin(wish, bookedSlot(wish.id, bookings), ctx) + bufferMin + nearest(wish, frame);
    byDate.get(frame.date)?.push(wish);
    load.set(frame.date, (load.get(frame.date) ?? 0) + extra);
  };

  const plannable = wishes
    .filter((w) => !w.suggested && !w.skipped)
    .sort((a, b) => a.sortHint - b.sortHint || cmp(a.id, b.id));
  const free: Wish[] = [];
  for (const wish of plannable) {
    if (!wish.place) {
      dropped.push({
        wishId: wish.id,
        reason: 'No place found yet — research it first',
      });
      if (wish.priority === 'must') warnings.push(`${wish.title} has no place yet, so it isn't planned`);
      continue;
    }
    const pin = pinnedDate(wish, bookings);
    const frame = pin ? frames.find((f) => f.date === pin) : undefined;
    if (pin && !frame) {
      warnings.push(`${wish.title} is pinned to ${pin}, outside the trip — planned on another day`);
    }
    if (frame) add(wish, frame);
    else free.push(wish);
  }

  // Open that day, with a window still long enough after the day starts
  // (matters when re-planning from the middle of today).
  const openDays = (wish: Wish) =>
    frames.filter((f) => {
      const w = wishWindows(wish, f.date, ctx.rules);
      // A meal-replacing wish only needs to START in its meal window.
      const need = wish.replacesMeal ? 0 : visitMin(wish, null);
      return (
        w === null ||
        w.some((x) => Math.min(x.closeMin, f.dayEndMin) - Math.max(x.openMin, f.dayStartMin) >= need)
      );
    });
  // A day already given over to another meal-replacing wish of the same kind.
  const mealTaken = (wish: Wish, frame: DayFrame) =>
    wish.replacesMeal !== null &&
    wish.replacesMeal !== undefined &&
    (byDate.get(frame.date) ?? []).some((w) => w.replacesMeal === wish.replacesMeal);
  free.sort((a, b) => {
    const pa = a.priority === 'must' ? 0 : 1;
    const pb = b.priority === 'must' ? 0 : 1;
    return (
      pa - pb ||
      openDays(a).length - openDays(b).length ||
      visitMin(b, null) - visitMin(a, null) ||
      a.sortHint - b.sortHint ||
      cmp(a.id, b.id)
    );
  });

  // A booked/fixed slot already taking the wanted part of that day.
  const slotInPart = (wish: Wish, frame: DayFrame): boolean => {
    if (wish.partOfDay === 'any') return false;
    const [from, to] = PART_RANGES[wish.partOfDay];
    return (byDate.get(frame.date) ?? []).some((w) => {
      const slot = bookedSlot(w.id, bookings);
      const startMin =
        slot?.date === frame.date ? slot.startMin : w.fixedDate === frame.date ? w.fixedStartMin : null;
      if (startMin === null || startMin === undefined) return false;
      return startMin < to && startMin + visitMin(w, slot) > from;
    });
  };

  for (const wish of free) {
    let candidates = openDays(wish);
    if (!candidates.length) {
      if (wish.priority === 'nice') {
        dropped.push({
          wishId: wish.id,
          reason: 'Closed on every day of the trip',
        });
        continue;
      }
      warnings.push(`${wish.title} is closed on every day of the trip`);
      candidates = frames;
    }
    let best: { frame: DayFrame; cost: number } | null = null;
    const duration = sightMin(wish, null, ctx) + bufferMin;
    const fits = (frame: DayFrame) =>
      frame.load !== 'light' ||
      (load.get(frame.date) ?? 0) + duration + nearest(wish, frame) <= capacityMin(ctx, frame);
    // Never pile onto a light day past its capacity, nor double a replaced meal.
    const allowed = candidates.filter((f) => fits(f) && !mealTaken(wish, f));
    if (allowed.length) candidates = allowed;
    for (const frame of candidates) {
      const cap = capacityMin(ctx, frame);
      const before = load.get(frame.date) ?? 0;
      const near = nearest(wish, frame);
      const after = before + duration + near;
      let cost = near + (BALANCE_WEIGHT * (after * after - before * before)) / (cap * cap);
      if (after > cap) cost += (after - Math.max(before, cap)) * OVERLOAD_PER_MIN;
      if (!openInPart(wish, frame.date) || slotInPart(wish, frame)) cost += PART_OF_DAY_MISS;
      if (!best || cost < best.cost - 1e-9) best = { frame, cost };
    }
    if (best) add(wish, best.frame);
    else if (frames.length === 0) dropped.push({ wishId: wish.id, reason: 'The trip has no days' });
  }

  for (const [date, list] of byDate) {
    for (const wish of list) {
      const w = windowsOn(wish.facts, date);
      if (w !== null && w.length === 0 && pinnedDate(wish, bookings) === date) {
        warnings.push(`${wish.title} is pinned to ${dayLabel(date)}, but it is closed that day`);
      }
    }
  }
  return { byDate, dropped, warnings };
}
