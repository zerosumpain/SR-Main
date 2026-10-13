// src/lib/trips/solver/items.ts
//
// The solver's working unit: one thing to do on one day (a wish or a meal),
// with its duration, hard start (booked/fixed), opening windows for that date
// and the warnings that do not depend on timing.

import type {
  Booking,
  DayHours,
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
}

export interface DayFrame {
  date: LocalDate;
  stay: Stay | null;
  dayStartMin: number;
  dayEndMin: number;
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

export function wishItem(wish: Wish, date: LocalDate, bookings: Booking[]): Item {
  const booking = bookedSlot(wish.id, bookings);
  const windows = windowsOn(wish.facts, date);
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
    locked: fixedStartMin !== null || wish.locked,
    bookingId,
    priority: wish.priority,
    partOfDay: wish.partOfDay,
    windows,
    baseWarnings: wishWarnings(wish, bookings, windows),
    sortHint: wish.sortHint,
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
    locked: false,
    bookingId: null,
    priority: null,
    partOfDay: 'any',
    windows: [{ openMin: w.fromMin, closeMin: w.toMin }],
    baseWarnings: [],
    sortHint: 0,
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
 * length. A locked stop keeps its planned start as a hard start.
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
      locked: stop.locked,
      bookingId: null,
      priority: null,
      partOfDay: 'any',
      windows: meal?.windows ?? null,
      baseWarnings: [],
      sortHint: 0,
    };
  }
  const wish = stop.wishId ? wishes.get(stop.wishId) : undefined;
  const windows = wish ? windowsOn(wish.facts, date) : null;
  return {
    id: stop.id,
    kind: 'wish',
    wishId: stop.wishId,
    title: stop.title,
    point: stop.wishId ?? stop.id,
    location: stop.location,
    durationMin,
    fixedStartMin: stop.locked ? startMin : null,
    locked: stop.locked,
    bookingId: stop.bookingId,
    priority: wish?.priority ?? null,
    partOfDay: wish?.partOfDay ?? 'any',
    windows,
    baseWarnings: wish ? wishWarnings(wish, bookings, windows) : [],
    sortHint: wish?.sortHint ?? 0,
  };
}
