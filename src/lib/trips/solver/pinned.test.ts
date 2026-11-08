// A wish pinned to a day (fixed date, fixed time or booked) outranks every
// unpinned wish of the same or lower priority on that day.
import { describe, expect, it } from 'vitest';
import type { Booking, PlannedDay, Priority, Wish } from '../model';
import {
  buildCaseInputs,
  lightWednesdayInput,
  longLunchInput,
  pinnedFridayInput,
} from './fixtures/cases/build';
import { romeInput } from './fixtures/rome';
import { replanDay, replanTrip, solveTrip, type ReplanInput, type TripReplanInput } from './index';

const RANK: Record<Priority, number> = { must: 0, nice: 1 };

function pinnedTo(wish: Wish, date: string, bookings: Booking[]): boolean {
  return (
    wish.fixedDate === date ||
    bookings.some((b) => b.wishId === wish.id && b.status === 'booked' && b.date === date)
  );
}

/** Violations: a dropped wish pinned to a day where an unpinned wish of equal/lower priority still sits. */
function violations(
  days: PlannedDay[],
  dropped: string[],
  wishes: Wish[],
  bookings: Booking[],
  missed: string[] = [],
): string[] {
  const byId = new Map(wishes.map((w) => [w.id, w]));
  const out: string[] = [];
  // A missed booked slot is not dropped for room; it is missed.
  for (const id of dropped.filter((d) => !missed.includes(d))) {
    const w = byId.get(id);
    if (!w) continue;
    for (const day of days) {
      if (!pinnedTo(w, day.date, bookings)) continue;
      for (const s of day.stops) {
        const other = s.wishId ? byId.get(s.wishId) : undefined;
        if (!other || other.id === w.id || s.locked || pinnedTo(other, day.date, bookings)) continue;
        if (RANK[other.priority] >= RANK[w.priority])
          out.push(`${id} dropped on ${day.date} while ${other.id} stays`);
      }
    }
  }
  return out;
}

/** Wishes whose booked slot an option reports as missed. */
function missedIn(day: PlannedDay, warnings: string[]): string[] {
  if (!warnings.some((w) => w.startsWith('Missed your'))) return [];
  return day.stops.filter((s) => s.locked && s.wishId).map((s) => s.wishId as string);
}

describe('pinned wishes outrank unpinned ones', () => {
  it('the preview case: Friday keeps the pinned Pincio and loses an unpinned nice', () => {
    const input = pinnedFridayInput();
    const plan = solveTrip(input);
    const fri = plan.days.find((d) => d.date === '2026-10-30')!;
    expect(fri.stops.some((s) => s.id === 'pincio')).toBe(true);
    expect(plan.dropped.map((d) => d.wishId)).not.toContain('pincio');
    expect(fri.warnings).toEqual([]);
  });

  it('PROPERTY: solveTrip never drops a pinned wish while an unpinned one of equal/lower priority sits on its day', () => {
    const variants = [
      romeInput(),
      lightWednesdayInput(),
      longLunchInput(),
      longLunchInput(null),
      pinnedFridayInput(),
    ];
    // Pin every nice to its planned day, one at a time, and lengthen it, to stress Friday-like days.
    for (const base of [romeInput(), pinnedFridayInput()]) {
      const plan = solveTrip(base);
      for (const day of plan.days) {
        for (const s of day.stops.filter((x) => x.kind === 'wish')) {
          const v = JSON.parse(JSON.stringify(base)) as typeof base;
          const w = v.wishes.find((x) => x.id === s.wishId)!;
          if (w.priority !== 'nice') continue;
          w.fixedDate = day.date;
          w.durationSec = (w.durationSec ?? 3600) + 90 * 60;
          variants.push(v);
        }
      }
    }
    for (const input of variants) {
      const plan = solveTrip(input);
      expect(
        violations(
          plan.days,
          plan.dropped.map((d) => d.wishId),
          input.wishes,
          input.bookings,
        ),
      ).toEqual([]);
    }
  });

  it('PROPERTY: replanDay and replanTrip options respect pins too', () => {
    for (const c of buildCaseInputs()) {
      if (c.fn === 'replanDay') {
        const input = c.input as ReplanInput;
        for (const o of replanDay(input)) {
          const missed = missedIn(input.day, o.day.warnings);
          const found = violations([o.day], o.dropped, input.wishes, input.bookings, missed);
          expect(found, `${c.name}/${o.id}`).toEqual([]);
        }
      }
      if (c.fn === 'replanTrip') {
        const input = c.input as TripReplanInput;
        for (const o of replanTrip(input)) {
          const missed = missedIn(input.day, o.days[0].warnings);
          const found = violations(o.days, o.dropped, input.wishes, input.bookings, missed);
          expect(found, `${c.name}/${o.id}`).toEqual([]);
        }
      }
    }
  });
});
