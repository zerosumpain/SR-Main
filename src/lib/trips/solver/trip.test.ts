import { describe, expect, it } from 'vitest';
import { TAXI_PICKUP_SEC, type PlannedDay, type PlannedStop } from '../model';
import { estimateLeg, estimateMatrix } from './estimate';
import { buildTripCaseInputs, type CaseInput } from './fixtures/cases/build';
import { makeTrip } from './fixtures/build';
import { replanTrip, type TripReplanInput } from './index';
import { chooseLeg, makeContext, modeSeconds, taxiSec } from './matrix';

const PANTHEON = { lat: 41.8986, lng: 12.4769 };
const VATICAN = { lat: 41.9065, lng: 12.4536 };

describe('taxi mode', () => {
  const points = [
    { id: 'a', location: PANTHEON },
    { id: 'b', location: VATICAN },
  ];

  it('is derived from the drive row plus the pick-up wait', () => {
    const m = estimateMatrix(points, ['walk', 'taxi']);
    expect(Object.keys(m.seconds)).toEqual(['walk', 'drive']);
    const drive = m.seconds.drive![0][1]!;
    expect(taxiSec(drive)).toBe(drive + TAXI_PICKUP_SEC);
    expect(modeSeconds(m, 'taxi', 0, 1)).toEqual({
      seconds: drive + TAXI_PICKUP_SEC,
      metres: m.metres.drive![0][1],
      estimated: true,
    });
    expect(estimateLeg(PANTHEON, VATICAN, 'taxi').seconds).toBe(
      estimateLeg(PANTHEON, VATICAN, 'drive').seconds + TAXI_PICKUP_SEC,
    );
  });

  it('competes with transit when the walk is too long, and only when allowed', () => {
    const m = estimateMatrix(points, ['walk', 'transit', 'taxi']);
    const withTaxi = makeContext(
      makeTrip('2026-10-27', '2026-10-27', { modes: ['walk', 'transit', 'taxi'] }),
      [],
      [],
      m,
    );
    expect(chooseLeg(withTaxi, 'a', 'b').mode).toBe('taxi');
    const noTaxi = makeContext(
      makeTrip('2026-10-27', '2026-10-27', { modes: ['walk', 'transit'] }),
      [],
      [],
      m,
    );
    expect(chooseLeg(noTaxi, 'a', 'b').mode).toBe('transit');
    const driveOnly = makeContext(
      makeTrip('2026-10-27', '2026-10-27', { modes: ['walk', 'drive', 'taxi'] }),
      [],
      [],
      m,
    );
    expect(chooseLeg(driveOnly, 'a', 'b').mode).toBe('drive'); // same route, no pick-up wait
  });

  it('falls back to transit when the matrix has no drive route', () => {
    const m = estimateMatrix(points, ['walk', 'transit', 'taxi']);
    m.seconds.drive = m.seconds.drive!.map((r) => r.map(() => null));
    const ctx = makeContext(
      makeTrip('2026-10-27', '2026-10-27', { modes: ['walk', 'transit', 'taxi'] }),
      [],
      [],
      m,
    );
    expect(chooseLeg(ctx, 'a', 'b').mode).toBe('transit');
  });
});

const cases = buildTripCaseInputs() as Array<Extract<CaseInput, { fn: 'replanTrip' }>>;
const inputOf = (name: string) => cases.find((c) => c.name === name)!.input as TripReplanInput;
const stopOf = (day: PlannedDay | undefined, id: string) => day?.stops.find((s) => s.id === id);

describe('replanTrip', () => {
  it('returns at most three distinct options covering today and every later day, deterministically', () => {
    for (const c of cases) {
      const input = inputOf(c.name);
      const options = replanTrip(input);
      expect(options.length).toBeGreaterThanOrEqual(1);
      expect(options.length).toBeLessThanOrEqual(3);
      expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
      const dates = input.plannedDays!.map((d) => d.date).filter((d) => d >= input.day.date);
      for (const o of options) {
        expect(o.days.map((d) => d.date)).toEqual(dates);
        expect(o.explanation.length).toBeGreaterThan(10);
      }
      expect(replanTrip(inputOf(c.name))).toEqual(options);
    }
  });

  it('unplanned stop near a later-day wish: pull it forward first', () => {
    const options = replanTrip(inputOf('trip-unplanned-stop-pull-forward'));
    expect(options[0].kind).toBe('pull-forward');
    expect(options[0].moved[0]).toEqual({ wishId: 'castel', from: '2026-10-30', to: '2026-10-27' });
    expect(stopOf(options[0].days[0], 'castel')).toBeDefined();
    expect(stopOf(options[0].days[3], 'castel')).toBeUndefined();
    expect(options[0].days[0].warnings).toEqual([]);
    expect(options.map((o) => o.kind)).toContain('stay-here');
  });

  it('missed booked slot: re-planning the rest moves the unfinished must to a later day', () => {
    const options = replanTrip(inputOf('trip-missed-slot-resolve-rest'));
    const resolve = options.find((o) => o.kind === 'resolve-rest')!;
    const move = resolve.moved.find((m) => m.wishId === 'colosseum')!;
    expect(move.from).toBe('2026-10-28');
    expect(move.to > '2026-10-28').toBe(true);
    expect(resolve.dropped).not.toContain('colosseum');
    expect(resolve.days[0].warnings).toContain('Missed your 09:30 Colosseum and Roman Forum slot');
    expect(resolve.explanation).toContain('needs a new booking');
    const carry = options.find((o) => o.kind === 'carry-on')!;
    expect(carry.dropped).toContain('colosseum');
    for (const o of options)
      for (const s of o.days[0].stops.filter(
        (x) => !['stay', 'meal'].includes(x.kind) || x.id.endsWith(':end'),
      )) {
        if (s.id.endsWith(':start')) continue;
        expect(s.arriveMin).toBeGreaterThanOrEqual(14 * 60 + 30);
      }
  });

  it('out of order: do the stop they reached now', () => {
    const input = inputOf('trip-out-of-order');
    const reached = input.observation!.stopId!;
    const [doneId] = input.doneStopIds;
    const title = input.day.stops.find((s) => s.id === reached)!.title;
    const options = replanTrip(input);
    expect(options[0]).toMatchObject({
      kind: 'pull-forward',
      label: `Do ${title} now, then carry on`,
      moved: [],
    });
    const ids = options[0].days[0].stops.map((s) => s.id);
    expect(ids.filter((id) => id === reached)).toHaveLength(1);
    expect(ids.indexOf(reached)).toBe(ids.indexOf(doneId) + 1);
  });

  it('takes a taxi when allowed and faster than transit', () => {
    const options = replanTrip(inputOf('trip-taxi-vs-transit'));
    const day = options[0].days[0];
    expect(day.legs.find((l) => l.toStopId === 'vatican')!.mode).toBe('taxi');
    expect(day.legs.some((l) => l.mode === 'transit')).toBe(false);
  });

  it('stay here on a day with no slack drops a nice', () => {
    const options = replanTrip(inputOf('trip-stay-here-no-slack'));
    const stay = options.find((o) => o.kind === 'stay-here')!;
    expect(stay.label).toBe('Stay at Bar on the Pincio until 11:30');
    expect(stay.dropped).toHaveLength(1);
    expect(stopOf(stay.days[0], 'here:2026-10-30:620')!.departMin).toBe(11 * 60 + 30);
    expect(stopOf(stay.days[0], stay.dropped[0])).toBeUndefined();
  });

  it('PROPERTY: no trip option moves a locked or booked stop', () => {
    for (const c of cases) {
      const input = inputOf(c.name);
      const planned = new Map<string, PlannedStop & { date: string }>();
      for (const d of [input.day, ...input.plannedDays!.filter((x) => x.date > input.day.date)]) {
        for (const s of d.stops) if (s.locked) planned.set(s.id, { ...s, date: d.date });
      }
      for (const o of replanTrip(input)) {
        for (const d of o.days) {
          for (const s of d.stops.filter((x) => x.locked)) {
            const was = planned.get(s.id);
            const label = `${c.name} / ${o.id} / ${s.id}`;
            expect(was, label).toBeDefined();
            expect(d.date, label).toBe(was!.date);
            expect([s.arriveMin, s.waitSec], label).toEqual([was!.arriveMin, was!.waitSec]);
            if (s.id !== input.atStopId) expect(s.departMin, label).toBe(was!.departMin);
          }
        }
        // A locked stop that is gone from its day is reported (missed slot).
        for (const [id, was] of planned) {
          const day = o.days.find((d) => d.date === was.date);
          if (day && !stopOf(day, id)) {
            const reported = o.dropped.includes(id) || o.moved.some((m) => m.wishId === id);
            expect(reported, `${c.name} / ${o.id} / ${id}`).toBe(true);
          }
        }
      }
    }
  });
});
