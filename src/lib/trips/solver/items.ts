// src/lib/trips/solver/items.ts
//
// The solver's working unit: one thing to do on one day (a wish or a meal),
// with its duration, hard start (booked/fixed), opening windows for that date
// and the warnings that do not depend on timing.

import type {
  Booking,
  DayHours,
  DayLoad,
  LocalDate,
  PaceRules,
  PartOfDay,
  PlannedStop,
  Priority,
  Stay,
  Wish,
} from '../model';
import { cmp } from './calendar';
import { windowsOn } from './hours';
import { stayPoint } from './matrix';

export const DEFAULT_VISIT_MIN = 60;

export type MealKind = 'lunch' | 'dinner';

export interface Item {
  /** Stop id: the wish id or `meal:<date>:lunch|dinner`. */
  id: string;
  kind: 'wish' | 'meal';
  wishId: string | null;
  title: string;
  /** Matrix point key; null = where the previous stop was (meals). */
  point: string | null;
  location: PlannedStop['location'];
  durationMin: number;
  /** Hard start minute (booked slot, fixed time, locked stop). */
  fixedStartMin: number | null;
  /** Hard end minute (a locked stop being re-timed keeps its planned end). */
  fixedEndMin: number | null;
  /** Re-planning only: show this planned arrival for a locked stop, whatever the timing. */
  heldArriveMin: number | null;
  locked: boolean;
  bookingId: string | null;
  priority: Priority | null;
  partOfDay: PartOfDay;
  /** null = unknown hours (treated as open), [] = closed all day. */
  windows: DayHours | null;
  /** Warnings that do not depend on timing (booking needed, hours unknown). */
  baseWarnings: string[];
  /** Lower = more valued (the person's own order). */
  sortHint: number;
  /** v2.1: this wish is that day's lunch/dinner (no automatic meal stop). */
  replacesMeal: MealKind | null;
  /** Pinned to this day (fixed date, fixed time or booked): outranks unpinned wishes. */
  pinned: boolean;
}

export interface DayFrame {
  date: LocalDate;
  stay: Stay | null;
  dayStartMin: number;
  dayEndMin: number;
  /** v2.1: how full the day should be (light ends earlier and takes less). */
  load?: DayLoad;
}

/** A light day ends this much earlier than the pace's day end. */
export const LIGHT_DAY_EARLIER_MIN = 90;
/** A light day takes about this share of the pace's active time. */
export const LIGHT_DAY_SHARE = 0.6;
/** A full day takes this share (it may run right up to the day's end). */
export const FULL_DAY_SHARE = 1.2;

/** The frame for a date under the pace and that date's load. */
export function dayFrame(
  rules: PaceRules,
  dayLoads: Partial<Record<LocalDate, DayLoad>>,
  date: LocalDate,
  stay: Stay | null,
): DayFrame {
  const load = dayLoads[date] ?? 'normal';
  return {
    date,
    stay,
    dayStartMin: rules.dayStartMin,
    dayEndMin: load === 'light' ? rules.dayEndMin - LIGHT_DAY_EARLIER_MIN : rules.dayEndMin,
    load,
  };
}

/** Dinner window for a wish that replaces dinner when the pace plans none. */
const FALLBACK_DINNER = { fromMin: 19 * 60, toMin: 21 * 60, durationSec: 75 * 60 };

/** The meal window a meal-replacing wish must start in: [fromMin, latest start]. */
export function replacedMealWindow(
  rules: PaceRules,
  kind: MealKind,
): { fromMin: number; latestStartMin: number } {
  const w = (kind === 'lunch' ? rules.lunch : rules.dinner) ?? FALLBACK_DINNER;
  return { fromMin: w.fromMin, latestStartMin: w.toMin - Math.round(w.durationSec / 60) };
}

/**
 * Opening windows for a wish on a date. A meal-replacing wish is narrowed to
 * start inside its meal window (it may run on past the window's end).
 */
export function wishWindows(wish: Wish, date: LocalDate, rules: PaceRules | null): DayHours | null {
  const windows = windowsOn(wish.facts, date);
  if (!wish.replacesMeal || !rules) return windows;
  const meal = replacedMealWindow(rules, wish.replacesMeal);
  const dur = visitMin(wish, null);
  const slot = { openMin: meal.fromMin, closeMin: meal.latestStartMin + dur };
  if (windows === null) return [slot];
  return windows
    .map((w) => ({
      openMin: Math.max(w.openMin, slot.openMin),
      closeMin: Math.min(w.closeMin, slot.closeMin),
    }))
    .filter((w) => w.closeMin > w.openMin);
}

/** The booked booking for a wish, if any (earliest date/time, then id). */
export function bookedSlot(wishId: string, bookings: Booking[]): Booking | null {
  const slots = bookings
    .filter((b) => b.wishId === wishId && b.status === 'booked' && b.date !== null && b.startMin !== null)
    .sort(
      (a, b) =>
        cmp(a.date as string, b.date as string) ||
        (a.startMin as number) - (b.startMin as number) ||
        cmp(a.id, b.id),
    );
  return slots[0] ?? null;
}

export function hasBooked(wishId: string, bookings: Booking[]): boolean {
  return bookings.some((b) => b.wishId === wishId && b.status === 'booked');
}

/** The date a wish is pinned to: its booked slot's date, else its fixed date. */
export function pinnedDate(wish: Wish, bookings: Booking[]): LocalDate | null {
  return bookedSlot(wish.id, bookings)?.date ?? wish.fixedDate ?? null;
}

export function visitMin(wish: Wish, booking: Booking | null): number {
  if (wish.durationSec !== null && wish.durationSec > 0) return Math.round(wish.durationSec / 60);
  const typical = wish.facts?.typicalVisitSec;
  if (typical !== null && typical !== undefined && typical > 0) return Math.round(typical / 60);
  if (booking && booking.startMin !== null && booking.endMin !== null && booking.endMin > booking.startMin) {
    return booking.endMin - booking.startMin;
  }
  return DEFAULT_VISIT_MIN;
}

export function wishWarnings(wish: Wish, bookings: Booking[], windows: DayHours | null): string[] {
  const out: string[] = [];
  if (wish.facts?.bookingRequired && !hasBooked(wish.id, bookings)) {
    const ahead = wish.facts.bookAheadDays;
    out.push(
      ahead !== null && ahead > 0
        ? `Booking needed ${ahead} day${ahead === 1 ? '' : 's'} ahead — not booked yet`
        : 'Booking needed — not booked yet',
    );
  }
  if (windows === null) out.push('Opening hours unknown — check before you go');
  return out;
}

export function wishItem(
  wish: Wish,
  date: LocalDate,
  bookings: Booking[],
  rules: PaceRules | null = null,
): Item {
  const booking = bookedSlot(wish.id, bookings);
  const windows = wishWindows(wish, date, rules);
  let fixedStartMin: number | null = null;
  let bookingId: string | null = null;
  if (booking && booking.date === date) {
    fixedStartMin = booking.startMin;
    bookingId = booking.id;
  } else if (wish.fixedDate === date && wish.fixedStartMin !== null) {
    fixedStartMin = wish.fixedStartMin;
  }
  return {
    id: wish.id,
    kind: 'wish',
    wishId: wish.id,
    title: wish.title,
    point: wish.id,
    location: wish.place?.location ?? null,
    durationMin: visitMin(wish, booking),
    fixedStartMin,
    fixedEndMin: null,
    heldArriveMin: null,
    locked: fixedStartMin !== null || wish.locked,
    bookingId,
    priority: wish.priority,
    partOfDay: wish.replacesMeal ? 'any' : wish.partOfDay,
    windows,
    baseWarnings: wishWarnings(wish, bookings, wish.replacesMeal ? windowsOn(wish.facts, date) : windows),
    sortHint: wish.sortHint,
    replacesMeal: wish.replacesMeal ?? null,
    pinned: fixedStartMin !== null || wish.fixedDate === date || booking?.date === date,
  };
}

export function mealWindow(rules: PaceRules, kind: MealKind) {
  return kind === 'lunch' ? rules.lunch : rules.dinner;
}

export function mealItem(date: LocalDate, kind: MealKind, rules: PaceRules): Item | null {
  const w = mealWindow(rules, kind);
  if (!w) return null;
  return {
    id: `meal:${date}:${kind}`,
    kind: 'meal',
    wishId: null,
    title: kind === 'lunch' ? 'Lunch' : 'Dinner',
    point: null,
    location: null,
    durationMin: Math.round(w.durationSec / 60),
    fixedStartMin: null,
    fixedEndMin: null,
    heldArriveMin: null,
    locked: false,
    bookingId: null,
    priority: null,
    partOfDay: 'any',
    windows: [{ openMin: w.fromMin, closeMin: w.toMin }],
    baseWarnings: [],
    sortHint: 0,
    replacesMeal: null,
    pinned: false,
  };
}

export function mealKindOf(stopId: string): MealKind | null {
  if (stopId.endsWith(':lunch')) return 'lunch';
  if (stopId.endsWith(':dinner')) return 'dinner';
  return null;
}

/** Matrix point of a planned stop (meals inherit, so null). */
export function pointOfStop(stop: PlannedStop, stayId: string | null): string | null {
  if (stop.kind === 'stay') return stayId ? stayPoint(stayId) : null;
  if (stop.kind === 'wish') return stop.wishId ?? stop.id;
  return null;
}

/**
 * Rebuild an item from an already-planned stop, keeping its planned visit
 * length. A locked stop keeps its planned start and end as hard times.
 */
export function itemFromStop(
  stop: PlannedStop,
  date: LocalDate,
  wishes: Map<string, Wish>,
  bookings: Booking[],
  rules: PaceRules,
): Item {
  const startMin = stop.arriveMin + Math.round(stop.waitSec / 60);
  const durationMin = Math.max(0, stop.departMin - startMin);
  if (stop.kind === 'meal') {
    const kind = mealKindOf(stop.id);
    const meal = kind ? mealItem(date, kind, rules) : null;
    return {
      id: stop.id,
      kind: 'meal',
      wishId: null,
      title: stop.title,
      point: null,
      location: null,
      durationMin,
      fixedStartMin: stop.locked ? startMin : null,
      fixedEndMin: stop.locked ? stop.departMin : null,
      heldArriveMin: null,
      locked: stop.locked,
      bookingId: null,
      priority: null,
      partOfDay: 'any',
      windows: meal?.windows ?? null,
      baseWarnings: [],
      sortHint: 0,
      replacesMeal: null,
      pinned: stop.locked,
    };
  }
  const wish = stop.wishId ? wishes.get(stop.wishId) : undefined;
  const windows = wish ? wishWindows(wish, date, rules) : null;
  return {
    id: stop.id,
    kind: 'wish',
    wishId: stop.wishId,
    title: stop.title,
    point: stop.wishId ?? stop.id,
    location: stop.location,
    durationMin,
    fixedStartMin: stop.locked ? startMin : null,
    fixedEndMin: stop.locked ? stop.departMin : null,
    heldArriveMin: null,
    locked: stop.locked,
    bookingId: stop.bookingId,
    priority: wish?.priority ?? null,
    partOfDay: wish?.replacesMeal ? 'any' : (wish?.partOfDay ?? 'any'),
    windows,
    baseWarnings: wish
      ? wishWarnings(wish, bookings, wish.replacesMeal ? windowsOn(wish.facts, date) : windows)
      : [],
    sortHint: wish?.sortHint ?? 0,
    replacesMeal: wish?.replacesMeal ?? null,
    pinned:
      stop.locked ||
      wish?.fixedDate === date ||
      (stop.wishId !== null && bookedSlot(stop.wishId, bookings)?.date === date),
  };
}
