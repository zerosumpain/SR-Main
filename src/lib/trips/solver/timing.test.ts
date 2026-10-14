import { describe, expect, it } from 'vitest';
import type { Booking, PlannedDay, Trip, Wish } from '../model';
import { estimateMatrix } from './estimate';
import { makeStay, makeTrip, makeWish } from './fixtures/build';
import { solveTrip, type SolverInput } from './index';
import { stayPoint } from './matrix';

const CAMPO = { lat: 41.8952, lng: 12.4716 };
const STAY = makeStay('campo', 'Campo flat', CAMPO, '2026-10-27', '2026-10-30');
// Points a few minutes' walk apart around the stay.
const near = (i: number) => ({ lat: CAMPO.lat + 0.002 * Math.cos(i), lng: CAMPO.lng + 0.002 * Math.sin(i) });

function input(
  wishes: Wish[],
  bookings: Booking[] = [],
  trip: Partial<Trip> = {},
  end = '2026-10-27',
): SolverInput {
  const points = [
    ...wishes.filter((w) => w.place).map((w) => ({ id: w.id, location: w.place!.location })),
    { id: stayPoint(STAY.id), location: STAY.location },
  ];
  const t = makeTrip('2026-10-27', end, trip);
  return { trip: t, stays: [STAY], wishes, bookings, matrix: estimateMatrix(points, t.modes) };
}

function booking(id: string, wishId: string, date: string, startMin: number): Booking {
  return {
    id,
    wishId,
    title: id,
    date,
    startMin,
    endMin: null,
    reference: null,
    url: null,
    documentId: null,
    status: 'booked',
  };
}

const stopOf = (day: PlannedDay, id: string) => day.stops.find((s) => s.id === id);
const startOf = (s: { arriveMin: number; waitSec: number }) => s.arriveMin + s.waitSec / 60;

describe('day shape', () => {
  it('starts and ends at the stay, with one leg between each pair of stops', () => {
    const plan = solveTrip(input([makeWish('a', 'A', near(1)), makeWish('b', 'B', near(2))]));
    const day = plan.days[0];
    expect(day.stops[0].id).toBe('stay:2026-10-27:start');
    expect(day.stops[day.stops.length - 1].id).toBe('stay:2026-10-27:end');
    expect(day.legs).toHaveLength(day.stops.length - 1);
    day.legs.forEach((leg, i) => {
      expect(leg.fromStopId).toBe(day.stops[i].id);
      expect(leg.toStopId).toBe(day.stops[i + 1].id);
      expect(leg.line).toBeNull();
    });
    for (let i = 1; i < day.stops.length; i++) {
      expect(day.stops[i].arriveMin).toBeGreaterThanOrEqual(day.stops[i - 1].departMin);
    }
  });

  it('uses the default 60-minute visit when nothing says how long', () => {
    const plan = solveTrip(input([makeWish('a', 'A', near(1), { minutes: null })]));
    const a = stopOf(plan.days[0], 'a')!;
    expect(a.departMin - startOf(a)).toBe(60);
  });
});

describe('meals', () => {
  const busy = () =>
    [1, 2, 3, 4].map((i) => makeWish(`w${i}`, `W${i}`, near(i), { minutes: 90, sortHint: i }));

  it('places lunch inside its window', () => {
    const day = solveTrip(input(busy())).days[0];
    const lunch = stopOf(day, 'meal:2026-10-27:lunch')!;
    expect(lunch.kind).toBe('meal');
    expect(startOf(lunch)).toBeGreaterThanOrEqual(12 * 60);
    expect(lunch.departMin).toBeLessThanOrEqual(14 * 60 + 30);
    expect(lunch.warnings).toEqual([]);
  });

  it('adds dinner at a packed pace', () => {
    const wishes = [...busy(), makeWish('w5', 'W5', near(5), { minutes: 240, sortHint: 5 })];
    const day = solveTrip(input(wishes, [], { pace: 'packed' })).days[0];
    const dinner = stopOf(day, 'meal:2026-10-27:dinner')!;
    expect(startOf(dinner)).toBeGreaterThanOrEqual(19 * 60);
    expect(dinner.departMin).toBeLessThanOrEqual(21 * 60);
  });

  it('leaves an empty day without meals', () => {
    const day = solveTrip(input([])).days[0];
    expect(day.stops.map((s) => s.kind)).toEqual(['stay', 'stay']);
  });
});

describe('warnings', () => {
  it('warns when a place closes soon after you arrive', () => {
    const wishes = [
      makeWish('slot', 'Slot', near(1), { minutes: 95 }),
      makeWish('late', 'Late', near(2), { minutes: 60, hours: 'Mo-Su 16:00-17:00' }),
    ];
    const day = solveTrip(input(wishes, [booking('bk', 'slot', '2026-10-27', 15 * 60)])).days[0];
    const late = stopOf(day, 'late')!;
    expect(late.warnings).toHaveLength(1);
    expect(late.warnings[0]).toMatch(/^Closes 17:00 — you arrive 16:\d\d$/);
  });

  it('warns when booking is needed and nothing is booked', () => {
    const facts = { bookingRequired: true, bookAheadDays: 30 };
    const plan = solveTrip(
      input(
        [makeWish('a', 'A', near(1), { facts }), makeWish('b', 'B', near(2), { facts })],
        [booking('bk-b', 'b', '2026-10-27', 14 * 60)],
      ),
    );
    expect(stopOf(plan.days[0], 'a')!.warnings).toContain('Booking needed 30 days ahead — not booked yet');
    expect(stopOf(plan.days[0], 'b')!.warnings).toEqual([]);
  });

  it('treats unknown hours as open, with a warning', () => {
    const plan = solveTrip(input([makeWish('a', 'A', near(1), { hours: 'ask at the door' })]));
    expect(stopOf(plan.days[0], 'a')!.warnings).toEqual(['Opening hours unknown — check before you go']);
  });
});

describe('fitting the day', () => {
  it('drops a nice with a plain reason when the day overflows', () => {
    const wishes = [
      makeWish('m1', 'M1', near(1), { minutes: 180, sortHint: 1 }),
      makeWish('m2', 'M2', near(2), { minutes: 180, sortHint: 2 }),
      makeWish('n1', 'Nice one', near(3), { minutes: 150, priority: 'nice', sortHint: 3 }),
    ];
    const plan = solveTrip(input(wishes));
    expect(plan.dropped).toHaveLength(1);
    expect(plan.dropped[0].wishId).toBe('n1');
    expect(plan.dropped[0].reason).toMatch(
      /^No time on Tue 27 Oct — the day would end at \d\d:\d\d, after 19:00$/,
    );
    expect(stopOf(plan.days[0], 'n1')).toBeUndefined();
  });

  it('drops the lowest-value nice first', () => {
    const wishes = [
      makeWish('m1', 'M1', near(1), { minutes: 300, sortHint: 1 }),
      makeWish('n-high', 'Liked', near(2), { minutes: 120, priority: 'nice', sortHint: 2 }),
      makeWish('n-low', 'Meh', near(3), { minutes: 120, priority: 'nice', sortHint: 3 }),
    ];
    const plan = solveTrip(input(wishes));
    expect(plan.dropped.map((d) => d.wishId)).toEqual(['n-low']);
  });

  it('never drops a must, warning instead', () => {
    const wishes = [1, 2, 3, 4, 5].map((i) =>
      makeWish(`m${i}`, `M${i}`, near(i), { minutes: 150, sortHint: i }),
    );
    const plan = solveTrip(input(wishes));
    expect(plan.dropped).toEqual([]);
    for (let i = 1; i <= 5; i++) expect(stopOf(plan.days[0], `m${i}`)).toBeDefined();
    expect(plan.days[0].warnings.some((w) => w.startsWith('Back at the stay'))).toBe(true);
  });

  it('puts an unpinned nice on a day with room', () => {
    const wishes = [
      makeWish('m1', 'M1', near(1), { minutes: 360, sortHint: 1, fixedDate: '2026-10-27' }),
      makeWish('m2', 'M2', near(2), { minutes: 240, sortHint: 2, fixedDate: '2026-10-28' }),
      makeWish('n1', 'N1', near(3), { minutes: 180, priority: 'nice', sortHint: 3 }),
    ];
    const plan = solveTrip(input(wishes, [], {}, '2026-10-28'));
    expect(plan.dropped).toEqual([]);
    expect(stopOf(plan.days[1], 'n1')).toBeDefined();
  });

  it('never moves a nice off the day it is pinned to (it is dropped there instead)', () => {
    const wishes = [
      makeWish('m1', 'M1', near(1), { minutes: 360, sortHint: 1, fixedDate: '2026-10-27' }),
      makeWish('m2', 'M2', near(2), { minutes: 240, sortHint: 2, fixedDate: '2026-10-28' }),
      makeWish('n1', 'N1', near(3), { minutes: 180, priority: 'nice', sortHint: 3, fixedDate: '2026-10-27' }),
    ];
    const plan = solveTrip(input(wishes, [], {}, '2026-10-28'));
    expect(plan.dropped.map((d) => d.wishId)).toEqual(['n1']);
    expect(plan.dropped[0].reason).toMatch(/^No time on Tue 27 Oct/);
    expect(stopOf(plan.days[1], 'n1')).toBeUndefined();
  });
});

describe('days', () => {
  it('respects closed days', () => {
    const wishes = [
      makeWish('mon-shut', 'Shut Tuesday', near(1), {
        hours: 'Mo-Su 09:00-18:00',
        facts: { closedDates: ['2026-10-27'] },
      }),
      makeWish('wed-shut', 'Shut Wednesdays', near(2), { hours: 'Mo,Tu,Th-Su 09:00-18:00' }),
    ];
    const plan = solveTrip(input(wishes, [], {}, '2026-10-28'));
    expect(stopOf(plan.days[0], 'mon-shut')).toBeUndefined();
    expect(stopOf(plan.days[1], 'mon-shut')).toBeDefined();
    expect(stopOf(plan.days[1], 'wed-shut')).toBeUndefined();
    expect(stopOf(plan.days[0], 'wed-shut')).toBeDefined();
  });

  it('drops a nice closed every day; keeps a must with a warning', () => {
    const wishes = [
      makeWish('nice-shut', 'Nice shut', near(1), { priority: 'nice', hours: 'Su 09:00-18:00' }),
      makeWish('must-shut', 'Must shut', near(2), { hours: 'Su 09:00-18:00' }),
    ];
    const plan = solveTrip(input(wishes, [], {}, '2026-10-28'));
    expect(plan.dropped).toEqual([{ wishId: 'nice-shut', reason: 'Closed on every day of the trip' }]);
    expect(plan.warnings).toContain('Must shut is closed on every day of the trip');
    const placed = plan.days.flatMap((d) => d.stops).find((s) => s.id === 'must-shut')!;
    expect(placed.warnings[0]).toMatch(/^Closed on /);
  });

  it('keeps a booked slot on its date and time, and leaves early for an early slot', () => {
    const wishes = [
      makeWish('early', 'Early', { lat: 41.9065, lng: 12.4536 }, { minutes: 120 }),
      makeWish('other', 'Other', near(2)),
    ];
    const plan = solveTrip(input(wishes, [booking('bk', 'early', '2026-10-28', 9 * 60)], {}, '2026-10-29'));
    const day = plan.days[1];
    const early = stopOf(day, 'early')!;
    expect(startOf(early)).toBe(9 * 60);
    expect(early.locked).toBe(true);
    expect(early.bookingId).toBe('bk');
    expect(early.warnings).toEqual([]);
    expect(day.stops[0].departMin).toBeLessThan(9 * 60);
    expect(stopOf(plan.days[0], 'early')).toBeUndefined();
    expect(stopOf(plan.days[2], 'early')).toBeUndefined();
  });

  it('puts a fixed-date wish on its date and ignores suggested and skipped wishes', () => {
    const wishes = [
      makeWish('fixed', 'Fixed', near(1), { fixedDate: '2026-10-29' }),
      makeWish('sugg', 'Suggested', near(2), { suggested: true }),
      makeWish('skip', 'Skipped', near(3), { skipped: true }),
    ];
    const plan = solveTrip(input(wishes, [], {}, '2026-10-29'));
    expect(stopOf(plan.days[2], 'fixed')).toBeDefined();
    const all = plan.days.flatMap((d) => d.stops.map((s) => s.id));
    expect(all).not.toContain('sugg');
    expect(all).not.toContain('skip');
  });

  it('reports a wish without a place', () => {
    const w = { ...makeWish('lost', 'Lost', near(1)), place: null };
    const plan = solveTrip(input([w]));
    expect(plan.dropped).toEqual([{ wishId: 'lost', reason: 'No place found yet — research it first' }]);
    expect(plan.warnings).toEqual(["Lost has no place yet, so it isn't planned"]);
  });
});
