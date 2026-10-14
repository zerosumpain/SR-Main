// v2.1: day loads (light / normal / full) and wishes that replace a meal.
import { describe, expect, it } from 'vitest';
import type { PlannedDay } from '../model';
import { lightWednesdayInput, longLunchInput } from './fixtures/cases/build';
import { romeInput } from './fixtures/rome';
import { solveTrip } from './index';

const WED = '2026-10-28';
const THU = '2026-10-29';
const dayOf = (plan: { days: PlannedDay[] }, date: string) => plan.days.find((d) => d.date === date)!;
const wishIds = (d: PlannedDay) => d.stops.filter((s) => s.kind === 'wish').map((s) => s.wishId);
const activeMin = (d: PlannedDay) =>
  d.stops
    .filter((s) => s.kind === 'wish')
    .reduce((t, s) => t + s.departMin - s.arriveMin - s.waitSec / 60, 0);
const endOf = (d: PlannedDay) => d.stops[d.stops.length - 1].arriveMin;

describe('light days', () => {
  const before = dayOf(solveTrip(romeInput()), WED);
  const plan = solveTrip(lightWednesdayInput());
  const light = dayOf(plan, WED);

  it('takes fewer active minutes and ends earlier, within the earlier end', () => {
    expect(activeMin(light)).toBeLessThan(activeMin(before));
    expect(endOf(light)).toBeLessThan(endOf(before));
    expect(endOf(light)).toBeLessThanOrEqual(19 * 60 - 90);
    expect(light.warnings).toEqual([]);
  });

  it('nothing is moved onto it, and its wishes are still planned elsewhere', () => {
    for (const id of wishIds(light)) expect(wishIds(before)).toContain(id);
    const all = plan.days.flatMap(wishIds);
    for (const id of wishIds(before)) expect(all).toContain(id);
    expect(plan.dropped).toEqual([]);
  });

  it('keeps a booked slot on a light day', () => {
    expect(light.stops.find((s) => s.id === 'colosseum')).toMatchObject({ locked: true });
  });
});

describe('a wish that replaces a meal', () => {
  it('is the only lunch-time stop that day, inside the lunch window', () => {
    const plan = solveTrip(longLunchInput());
    const thu = dayOf(plan, THU);
    expect(thu.stops.some((s) => s.kind === 'meal')).toBe(false);
    const lunch = thu.stops.find((s) => s.id === 'trastevere-lunch')!;
    const start = lunch.arriveMin + lunch.waitSec / 60;
    expect(start).toBeGreaterThanOrEqual(12 * 60);
    expect(start).toBeLessThanOrEqual(14 * 60 + 30 - 60);
    expect(lunch.warnings).toEqual([]);
    // Every other day keeps its automatic lunch.
    for (const d of plan.days.filter((x) => x.date !== THU)) {
      expect(d.stops.filter((s) => s.id === `meal:${d.date}:lunch`)).toHaveLength(1);
    }
  });

  it('without a date, lands on a day whose lunch it takes', () => {
    const plan = solveTrip(longLunchInput(null));
    const day = plan.days.find((d) => d.stops.some((s) => s.id === 'trastevere-lunch'))!;
    expect(day.stops.some((s) => s.kind === 'meal')).toBe(false);
    const lunch = day.stops.find((s) => s.id === 'trastevere-lunch')!;
    expect(lunch.arriveMin + lunch.waitSec / 60).toBeLessThanOrEqual(13 * 60 + 30);
  });

  it('two lunch-replacing wishes never share a day', () => {
    const input = longLunchInput(null);
    const second = {
      ...input.wishes[input.wishes.length - 1],
      id: 'second-lunch',
      title: 'Second long lunch',
    };
    input.wishes.push(second);
    const idx = input.matrix.points.indexOf('trastevere-lunch');
    input.matrix.points.push('second-lunch');
    for (const table of [input.matrix.seconds, input.matrix.metres]) {
      for (const mode of Object.keys(table) as Array<keyof typeof table>) {
        const rows = table[mode]!;
        rows.forEach((r) => r.push(r[idx]));
        rows.push([...rows[idx]]);
        rows[rows.length - 1][rows.length - 1] = 0;
      }
    }
    const plan = solveTrip(input);
    const days = plan.days.filter((d) =>
      d.stops.some((s) => s.id === 'trastevere-lunch' || s.id === 'second-lunch'),
    );
    expect(days).toHaveLength(2);
  });
});
