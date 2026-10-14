// v3: flights/trains frame the arrival and departure days.
import { describe, expect, it } from 'vitest';
import type { PlannedDay } from '../model';
import { buildCaseInputs } from './fixtures/cases/build';
import { romeTransportInput } from './fixtures/rome';
import { replanDay, replanTrip, solveTrip, type ReplanInput, type TripReplanInput } from './index';

/** Overlaps between a transport stop and anything else on the day. */
function overlaps(day: PlannedDay): string[] {
  const out: string[] = [];
  const transport = day.stops.filter((s) => s.kind === 'transport');
  for (const t of transport) {
    for (const s of day.stops) {
      if (s === t) continue;
      if (s.arriveMin < t.departMin && s.departMin > t.arriveMin)
        out.push(`${s.id} overlaps ${t.id} on ${day.date}`);
    }
    const i = day.stops.indexOf(t);
    if (t.id.endsWith(':arrive') && i !== 0) out.push(`${t.id} is not first`);
    if (t.id.endsWith(':depart') && i !== day.stops.length - 1) out.push(`${t.id} is not last`);
  }
  // On travel days the whole timeline must also run in order.
  for (let i = 1; transport.length && i < day.stops.length; i++) {
    if (day.stops[i].arriveMin < day.stops[i - 1].departMin)
      out.push(`${day.stops[i].id} starts before ${day.stops[i - 1].id} ends`);
  }
  return out;
}

const startOf = (s: { arriveMin: number; waitSec: number }) => s.arriveMin + s.waitSec / 60;

describe('arrival and departure days', () => {
  const plan = solveTrip(romeTransportInput());
  const [arrive, , , leave] = plan.days;

  it('starts the arrival day at the landing: exit, transfer, drop bags before check-in, lunch near the stay', () => {
    expect(arrive.stops.slice(0, 2).map((s) => [s.id, s.arriveMin, s.departMin])).toEqual([
      ['transport:out:arrive', 11 * 60 + 5, 11 * 60 + 45],
      ['stay:2026-10-27:bags', 12 * 60 + 45, 13 * 60],
    ]);
    expect(arrive.stops[1].title).toBe("Drop bags at Apartment by Campo de' Fiori");
    expect(arrive.legs[0]).toMatchObject({ mode: 'transit', durationSec: 3600 });
    const lunch = arrive.stops.find((s) => s.kind === 'meal')!;
    expect(startOf(lunch)).toBeLessThan(15 * 60);
    const sights = arrive.stops.filter((s) => s.kind === 'wish');
    expect(sights.some((s) => startOf(s) < 15 * 60)).toBe(true);
    expect(arrive.stops.some((s) => s.id.includes('checkin'))).toBe(false);
  });

  it('ends the departure day with check-out, bags by ~15:30 and the airport transfer', () => {
    const ids = leave.stops.map((s) => s.id);
    expect(ids.slice(0, 2)).toEqual(['stay:2026-10-30:start', 'stay:2026-10-30:checkout']);
    expect(leave.stops[1].departMin).toBeLessThanOrEqual(10 * 60);
    const bags = leave.stops[leave.stops.length - 2];
    expect(bags).toMatchObject({
      id: 'stay:2026-10-30:end',
      title: "Collect bags at Apartment by Campo de' Fiori",
    });
    expect(bags.arriveMin).toBeLessThanOrEqual(15 * 60 + 25);
    expect(bags.departMin).toBe(15 * 60 + 40);
    expect(leave.stops[leave.stops.length - 1]).toMatchObject({
      id: 'transport:back:depart',
      kind: 'transport',
      arriveMin: 16 * 60 + 40,
      departMin: 18 * 60 + 40,
    });
    expect(leave.warnings).toEqual([]);
  });

  it('makes travel days light unless dayLoads says otherwise', () => {
    const active = (d: PlannedDay) => d.stops.filter((s) => s.kind === 'wish').length;
    expect(arrive.stops[arrive.stops.length - 1].arriveMin).toBeLessThanOrEqual(19 * 60 - 90);
    const input = romeTransportInput();
    input.trip.dayLoads = { '2026-10-27': 'normal' };
    const normal = solveTrip(input).days[0];
    expect(active(normal)).toBeGreaterThan(active(arrive));
  });

  it('a check-in stop replaces the bag drop when arriving after check-in', () => {
    const input = romeTransportInput();
    input.stays[0].checkInMin = 12 * 60;
    expect(solveTrip(input).days[0].stops[1]).toMatchObject({
      id: 'stay:2026-10-27:checkin',
      title: "Check in at Apartment by Campo de' Fiori",
    });
  });

  it('drops a booked slot that clashes with the journey home, with the reason', () => {
    const input = romeTransportInput();
    input.bookings.find((b) => b.id === 'bk-borghese')!.startMin = 15 * 60;
    const p = solveTrip(input);
    expect(p.dropped).toContainEqual({
      wishId: 'borghese',
      reason: "Booked for 15:00 on Fri 30 Oct, but you're travelling then",
    });
  });

  it('a 2 h delay re-frames the arrival day and skips lunch', () => {
    const c = buildCaseInputs().find((x) => x.name === 'replan-arrival-delayed')!.input as ReplanInput;
    for (const o of replanDay(c)) {
      expect(o.day.stops[0]).toMatchObject({ arriveMin: 13 * 60 + 5, departMin: 13 * 60 + 45 });
      expect(o.day.stops.some((s) => s.kind === 'meal')).toBe(false);
      expect(o.day.warnings[0]).toBe("No time for lunch — it's past 14:30; grab something on the way");
    }
  });

  it('PROPERTY: nothing overlaps a transport window, in plans and every replan option', () => {
    for (const d of [...plan.days, ...solveTrip(romeTransportInput(120)).days])
      expect(overlaps(d)).toEqual([]);
    for (const c of buildCaseInputs()) {
      if (c.fn === 'solveTrip')
        for (const d of solveTrip(c.input).days) expect(overlaps(d), c.name).toEqual([]);
      if (c.fn === 'replanDay')
        for (const o of replanDay(c.input as ReplanInput))
          expect(overlaps(o.day), `${c.name}/${o.id}`).toEqual([]);
      if (c.fn === 'replanTrip')
        for (const o of replanTrip(c.input as TripReplanInput))
          for (const d of o.days) expect(overlaps(d), `${c.name}/${o.id}`).toEqual([]);
    }
  });
});
