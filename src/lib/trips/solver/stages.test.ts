// v4: every stop carries a stage; stages run morning → lunch → afternoon → evening.
import { describe, expect, it } from 'vitest';
import { DAY_STAGES, type PlannedDay } from '../model';
import { estimateMatrix } from './estimate';
import { buildCaseInputs } from './fixtures/cases/build';
import { makeWish } from './fixtures/build';
import { romeInput, romePoints, romeTransportInput } from './fixtures/rome';
import {
  replanDay,
  replanTrip,
  retimeDay,
  solveTrip,
  stageOf,
  type ReplanInput,
  type TripReplanInput,
} from './index';
import { solverRules } from './rules';

function stageProblems(day: PlannedDay): string[] {
  const out: string[] = [];
  let last = 0;
  for (const s of day.stops) {
    if (!s.stage) {
      out.push(`${day.date} ${s.id} has no stage`);
      continue;
    }
    const k = DAY_STAGES.indexOf(s.stage);
    if (k < last) out.push(`${day.date} ${s.id} goes back to ${s.stage}`);
    last = Math.max(last, k);
    if (s.id.endsWith(':breakfast') && s.stage !== 'morning') out.push(`${s.id} is ${s.stage}`);
    if (s.kind === 'meal' && s.id.endsWith(':lunch') && s.stage !== 'lunch')
      out.push(`${s.id} is ${s.stage}`);
    if (s.kind === 'meal' && s.id.endsWith(':dinner') && s.stage !== 'evening')
      out.push(`${s.id} is ${s.stage}`);
  }
  return out;
}

describe('stages', () => {
  it('stageOf: meals anchor lunch and evening; travel takes the stage it falls in', () => {
    const plan = solveTrip(romeTransportInput());
    const arrive = plan.days[0];
    expect(arrive.stops.map((s) => s.stage)).toEqual(
      stageOf(arrive.stops, (s) => (s.kind === 'meal' ? (s.id.split(':')[2] as 'lunch') : null)),
    );
    expect(arrive.stops[0]).toMatchObject({ kind: 'transport', stage: 'morning' });
    const leave = plan.days[plan.days.length - 1];
    expect(leave.stops[leave.stops.length - 1]).toMatchObject({ kind: 'transport', stage: 'afternoon' });
  });

  it('each Rome day reads breakfast → morning → lunch → afternoon → dinner → evening', () => {
    for (const day of solveTrip(romeInput()).days) {
      const meals = day.stops.filter((s) => s.kind === 'meal').map((s) => s.id.split(':')[2]);
      expect(meals).toEqual(['breakfast', 'lunch', 'dinner']);
      expect(new Set(day.stops.map((s) => s.stage))).toEqual(new Set(DAY_STAGES));
      expect(stageProblems(day)).toEqual([]);
    }
  });

  it('PROPERTY: stages never go backwards, in every plan and every re-plan option', () => {
    const days: PlannedDay[] = [];
    for (const input of [romeInput(), romeTransportInput(), romeTransportInput(120)])
      days.push(...solveTrip(input).days);
    for (const c of buildCaseInputs()) {
      if (c.fn === 'solveTrip') days.push(...solveTrip(c.input).days);
      if (c.fn === 'replanDay') for (const o of replanDay(c.input as ReplanInput)) days.push(o.day);
      if (c.fn === 'replanTrip') for (const o of replanTrip(c.input as TripReplanInput)) days.push(...o.days);
      if (c.fn === 'retimeDay') {
        const { day, fromIndex, startMin, ...rest } = c.input as Parameters<typeof retimeDay>[3] & {
          day: PlannedDay;
          fromIndex: number;
          startMin: number;
        };
        days.push(retimeDay(day, fromIndex, startMin, rest));
      }
    }
    for (const d of days) expect(stageProblems(d)).toEqual([]);
  });
});

describe('meals for every pace', () => {
  it('dinner windows: normal 19:00–21:30, relaxed 19:30–21:30, packed keeps its own; home after dinner', () => {
    expect(solverRules('normal')).toMatchObject({
      dinner: { fromMin: 1140, toMin: 1290 },
      dayEndMin: 1350,
      activeEndMin: 1140,
    });
    expect(solverRules('relaxed')).toMatchObject({
      dinner: { fromMin: 1170, toMin: 1290 },
      activeEndMin: 1110,
    });
    expect(solverRules('packed')).toMatchObject({ dinner: { fromMin: 1140, toMin: 1260 }, dayEndMin: 1260 });
  });

  it('breakfast is at the stay just before setting off', () => {
    const day = solveTrip(romeInput()).days[0];
    expect(day.stops.slice(0, 2).map((s) => [s.id, s.arriveMin, s.departMin])).toEqual([
      ['stay:2026-10-27:start', 8 * 60 + 30, 8 * 60 + 30],
      ['meal:2026-10-27:breakfast', 8 * 60 + 30, 9 * 60],
    ]);
  });

  it('a café wish can replace breakfast, inside 07:30–10:00', () => {
    const input = romeInput();
    input.wishes.push(
      makeWish(
        'cafe',
        'Breakfast at Roscioli Caffè',
        { lat: 41.8937, lng: 12.4743 },
        {
          priority: 'must',
          minutes: 30,
          hours: 'Mo-Sa 07:00-19:00',
          fixedDate: '2026-10-27',
          replacesMeal: 'breakfast',
        },
      ),
    );
    input.matrix = estimateMatrix(romePoints(input.wishes, input.stays), input.trip.modes);
    const day = solveTrip(input).days[0];
    expect(day.stops.some((s) => s.id === 'meal:2026-10-27:breakfast')).toBe(false);
    const cafe = day.stops.find((s) => s.id === 'cafe')!;
    expect(cafe.stage).toBe('morning');
    expect(cafe.arriveMin + cafe.waitSec / 60).toBeLessThanOrEqual(9 * 60 + 30);
    expect(day.stops.filter((s) => s.kind === 'wish')[0].id).toBe('cafe');
  });

  it('an arrival day gets breakfast only when it lands early enough', () => {
    const early = romeTransportInput();
    early.transport[0].arriveMin = 6 * 60 + 30; // bags dropped by 08:25
    const day = solveTrip(early).days[0];
    const bf = day.stops.find((s) => s.id.endsWith(':breakfast'))!;
    expect(bf.arriveMin + bf.waitSec / 60).toBeLessThanOrEqual(9 * 60 + 30);
    expect(solveTrip(romeTransportInput()).days[0].stops.some((s) => s.id.endsWith(':breakfast'))).toBe(
      false,
    );
  });

  it('days do not get busier: sightseeing still ends by the old day end', () => {
    for (const day of solveTrip(romeInput()).days) {
      const sights = day.stops.filter((s) => s.kind === 'wish' && s.wishId !== 'trastevere');
      for (const s of sights) expect(s.departMin, s.id).toBeLessThanOrEqual(19 * 60);
    }
  });
});
