import { describe, expect, it } from 'vitest';
import { PACE_RULES } from '../model';
import { romeInput, ROME_BOOKINGS, ROME_WISHES } from './fixtures/rome';
import { isoWeekday } from './calendar';
import { solveTrip } from './index';
import { solverRules } from './rules';

const startOf = (s: { arriveMin: number; waitSec: number }) => s.arriveMin + s.waitSec / 60;

describe('solveTrip on the Rome trip', () => {
  const plan = solveTrip(romeInput());
  const stops = plan.days.flatMap((d) => d.stops.map((s) => ({ ...s, date: d.date })));

  it('plans four days, each from and back to the stay, within the day', () => {
    expect(plan.days.map((d) => d.date)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    for (const day of plan.days) {
      expect(day.stayId).toBe('campo');
      expect(day.stops[0].id).toBe(`stay:${day.date}:start`);
      expect(day.stops[day.stops.length - 1].id).toBe(`stay:${day.date}:end`);
      // v4: back after dinner by the day's end; sightseeing by the pace's old day end.
      expect(day.stops[day.stops.length - 1].arriveMin).toBeLessThanOrEqual(solverRules('normal').dayEndMin);
      for (const s of day.stops.filter((x) => x.kind === 'wish' && x.wishId !== 'trastevere')) {
        expect(s.departMin, s.id).toBeLessThanOrEqual(PACE_RULES.normal.dayEndMin);
      }
      for (const meal of ['breakfast', 'dinner']) {
        expect(day.stops.some((s) => s.id === `meal:${day.date}:${meal}`)).toBe(true);
      }
      expect(day.warnings).toEqual([]);
      expect(day.stops.some((s) => s.id === `meal:${day.date}:lunch`)).toBe(true);
      for (let i = 1; i < day.stops.length; i++) {
        expect(day.stops[i].arriveMin).toBeGreaterThanOrEqual(day.stops[i - 1].departMin);
      }
    }
    expect(plan.warnings).toEqual([]);
    expect(Number.isFinite(plan.score)).toBe(true);
  });

  it('places every must exactly once', () => {
    for (const wish of ROME_WISHES.filter((w) => w.priority === 'must')) {
      expect(stops.filter((s) => s.wishId === wish.id)).toHaveLength(1);
    }
  });

  it('accounts for every wish: planned once or dropped with a reason', () => {
    for (const wish of ROME_WISHES) {
      const placed = stops.filter((s) => s.wishId === wish.id).length;
      const dropped = plan.dropped.filter((d) => d.wishId === wish.id);
      expect(placed + dropped.length).toBe(1);
      for (const d of dropped) expect(d.reason.length).toBeGreaterThan(0);
    }
  });

  it('keeps booked slots on their dates and times, locked, without warnings', () => {
    for (const b of ROME_BOOKINGS) {
      const s = stops.find((x) => x.wishId === b.wishId)!;
      expect(s.date).toBe(b.date);
      expect(startOf(s)).toBe(b.startMin);
      expect(s.locked).toBe(true);
      expect(s.bookingId).toBe(b.id);
      expect(s.warnings).toEqual([]);
    }
  });

  it('respects opening hours', () => {
    for (const s of stops.filter((x) => x.kind === 'wish')) {
      const wish = ROME_WISHES.find((w) => w.id === s.wishId)!;
      expect(s.warnings, s.id).toEqual([]);
      const hours = wish.facts!.hours!;
      const windows = hours[isoWeekday(s.date)]!;
      expect(
        windows.some((w) => startOf(s) >= w.openMin && s.departMin <= w.closeMin),
        s.id,
      ).toBe(true);
    }
  });

  it('walks short legs and takes transit for long ones', () => {
    const input = romeInput();
    const idx = (stopId: string) =>
      input.matrix.points.indexOf(stopId.startsWith('stay:') ? 'stay:campo' : stopId);
    for (const day of plan.days) {
      for (const leg of day.legs) {
        const i = idx(leg.fromStopId);
        const j = idx(leg.toStopId);
        if (i < 0 || j < 0 || leg.durationSec === 0) continue;
        const walk = input.matrix.seconds.walk![i][j]!;
        if (walk <= PACE_RULES.normal.walkLimitSec) expect(leg.mode).toBe('walk');
        else expect(leg.mode).toBe('transit');
        expect(leg.distanceM).toBe(input.matrix.metres[leg.mode]![i][j]);
        expect(leg.estimated).toBe(true);
      }
    }
    expect(plan.days.flatMap((d) => d.legs).some((l) => l.mode === 'transit')).toBe(true);
    expect(plan.days.flatMap((d) => d.legs).some((l) => l.mode === 'walk' && l.durationSec > 0)).toBe(true);
  });

  it('is deterministic: same input, same plan', () => {
    expect(solveTrip(romeInput())).toEqual(plan);
  });

  it('does not depend on the order wishes and bookings arrive in', () => {
    const input = romeInput();
    input.wishes.reverse();
    input.bookings.reverse();
    expect(solveTrip(input)).toEqual(plan);
  });

  it('never moves a booked slot when everything else changes', () => {
    const input = romeInput();
    for (const w of input.wishes) if (w.priority === 'nice') w.priority = 'must';
    const busy = solveTrip(input);
    const all = busy.days.flatMap((d) => d.stops.map((s) => ({ ...s, date: d.date })));
    for (const b of ROME_BOOKINGS) {
      const s = all.find((x) => x.wishId === b.wishId)!;
      expect(s.date).toBe(b.date);
      expect(startOf(s)).toBe(b.startMin);
    }
    for (const w of input.wishes) expect(all.filter((s) => s.wishId === w.id)).toHaveLength(1);
  });
});
