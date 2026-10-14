// src/lib/trips/solver/fixtures/cases/build.ts
//
// Builds the inputs of the shared re-timing / re-planning cases from the
// Rome trip. The JSON files beside this are these inputs plus the TS
// solver's answers; the iPhone app replays the same JSON against its Swift
// port. Regenerate with `TRIPS_WRITE_CASES=1 npx vitest run
// src/lib/trips/solver/cases.test.ts` — only when a behaviour change is
// intended, and port it to Swift too.

import type {
  LatLng,
  Observation,
  PlannedDay,
  ReplanOption,
  SolvedPlan,
  TripReplanOption,
} from '../../../model';
import { estimateMatrix } from '../../estimate';
import {
  solveTrip,
  type ReplanInput,
  type RetimeInput,
  type SolverInput,
  type TripReplanInput,
} from '../../index';
import { makeWish } from '../build';
import { sliceMatrix, stayPoint } from '../../matrix';
import { romeInput, romePoints } from '../rome';

export interface RetimeCaseInput extends RetimeInput {
  day: PlannedDay;
  fromIndex: number;
  startMin: number;
}

export type SolverCase =
  | { name: string; description: string; fn: 'retimeDay'; input: RetimeCaseInput; expected: PlannedDay }
  | { name: string; description: string; fn: 'replanDay'; input: ReplanInput; expected: ReplanOption[] }
  | { name: string; description: string; fn: 'solveTrip'; input: SolverInput; expected: SolvedPlan }
  | {
      name: string;
      description: string;
      fn: 'replanTrip';
      input: TripReplanInput;
      expected: TripReplanOption[];
    };

export type CaseInput =
  | Omit<Extract<SolverCase, { fn: 'retimeDay' }>, 'expected'>
  | Omit<Extract<SolverCase, { fn: 'replanDay' }>, 'expected'>
  | Omit<Extract<SolverCase, { fn: 'replanTrip' }>, 'expected'>
  | Omit<Extract<SolverCase, { fn: 'solveTrip' }>, 'expected'>;

/** The day's own slice of the Rome input: its wishes, its stay, its matrix. */
function dayInput(date: string, edit?: (input: ReturnType<typeof romeInput>) => void) {
  const rome = romeInput();
  const plan = solveTrip(rome);
  const day = plan.days.find((d) => d.date === date);
  if (!day) throw new Error(`No planned day ${date}`);
  const wishIds = new Set(day.stops.map((s) => s.wishId).filter((id): id is string => id !== null));
  const input = {
    trip: rome.trip,
    stays: rome.stays,
    wishes: rome.wishes.filter((w) => wishIds.has(w.id)),
    bookings: rome.bookings.filter((b) => b.wishId !== null && wishIds.has(b.wishId)),
    matrix: sliceMatrix(rome.matrix, [...wishIds, ...rome.stays.map((s) => stayPoint(s.id))]),
  };
  edit?.(input);
  return { input, day };
}

function indexOf(day: PlannedDay, stopId: string): number {
  const i = day.stops.findIndex((s) => s.id === stopId);
  if (i < 0) throw new Error(`No stop ${stopId} on ${day.date}`);
  return i;
}

function stop(day: PlannedDay, stopId: string) {
  return day.stops[indexOf(day, stopId)];
}

const NEAR_PANTHEON: LatLng = { lat: 41.8991, lng: 12.4765 };

export function buildCaseInputs(): CaseInput[] {
  const cases: CaseInput[] = [];

  {
    const { input, day } = dayInput('2026-10-27');
    const i = indexOf(day, 'spanish-steps');
    cases.push({
      name: 'retime-running-late',
      description: 'Leave the Pantheon 25 minutes late; the rest of the day slides back in the same order.',
      fn: 'retimeDay',
      input: { ...input, day, fromIndex: i, startMin: stop(day, 'pantheon').departMin + 10 + 25 },
    });
  }
  {
    const { input, day } = dayInput('2026-10-28');
    cases.push({
      name: 'retime-late-start-booked-slot',
      description:
        'Leave the stay at 09:30 on Colosseum day: the 09:30 slot is missed, so a warning, not a move.',
      fn: 'retimeDay',
      input: { ...input, day, fromIndex: 0, startMin: 9 * 60 + 30 },
    });
  }
  {
    const { input, day } = dayInput('2026-10-30');
    cases.push({
      name: 'retime-locked-slot-absorbs-delay',
      description: 'Leave the market 10 minutes late; the Borghese slot stays at 15:00 and the wait shrinks.',
      fn: 'retimeDay',
      input: {
        ...input,
        day,
        fromIndex: indexOf(day, 'campo-market') + 1,
        startMin: stop(day, 'campo-market').departMin + 10 + 10,
      },
    });
  }
  {
    const { input, day } = dayInput('2026-10-27');
    cases.push({
      name: 'replan-on-time',
      description: 'At Piazza Navona exactly on time: carry on as planned.',
      fn: 'replanDay',
      input: {
        ...input,
        day,
        nowMin: stop(day, 'navona').departMin,
        position: null,
        atStopId: 'navona',
        doneStopIds: [],
      },
    });
  }
  {
    const { input, day } = dayInput('2026-10-27');
    cases.push({
      name: 'replan-running-late',
      description: 'Still at the Capitoline 150 minutes after leaving was planned: push back or drop a nice.',
      fn: 'replanDay',
      input: {
        ...input,
        day,
        nowMin: stop(day, 'capitoline').departMin + 10 + 150,
        position: null,
        atStopId: 'capitoline',
        doneStopIds: ['navona', 'pantheon', 'spanish-steps', 'trevi', 'meal:2026-10-27:lunch'],
      },
    });
  }
  {
    const { input, day } = dayInput('2026-10-27');
    cases.push({
      name: 'replan-skipped-stop',
      description: 'Skipped Piazza Navona and the Spanish Steps; walking near the Pantheon at 09:20.',
      fn: 'replanDay',
      input: {
        ...input,
        day,
        nowMin: 9 * 60 + 20,
        position: NEAR_PANTHEON,
        atStopId: null,
        doneStopIds: ['navona', 'spanish-steps'],
      },
    });
  }
  {
    const { input, day } = dayInput('2026-10-30');
    cases.push({
      name: 'replan-locked-slot',
      description:
        'Still at the Pincio 40 minutes late: whatever the option, the 15:00 Borghese slot stays at 15:00.',
      fn: 'replanDay',
      input: {
        ...input,
        day,
        nowMin: stop(day, 'pincio').departMin + 10 + 40,
        position: null,
        atStopId: 'pincio',
        doneStopIds: [],
      },
    });
  }
  {
    const { input, day } = dayInput('2026-10-28');
    cases.push({
      name: 'replan-missed-slot',
      description:
        'Colosseum day, 12:00, nothing done: the 09:30 slot is missed. It leaves the plan with a warning; nothing locked moves.',
      fn: 'replanDay',
      input: { ...input, day, nowMin: 12 * 60, position: null, atStopId: null, doneStopIds: [] },
    });
  }
  {
    const { input, day } = dayInput('2026-10-28');
    cases.push({
      name: 'replan-late-for-slot',
      description:
        'Colosseum day, still at the stay at 09:20: 13 minutes late for the 09:30 slot (inside the 30-minute grace). The slot keeps its planned times and carries a warning.',
      fn: 'replanDay',
      input: { ...input, day, nowMin: 9 * 60 + 20, position: null, atStopId: null, doneStopIds: [] },
    });
  }
  {
    const { input, day } = dayInput('2026-10-30');
    cases.push({
      name: 'replan-squeezed-before-slot',
      description:
        'Borghese day, still at the stay at 11:30: what no longer fits before the 15:00 slot moves after it or is dropped.',
      fn: 'replanDay',
      input: { ...input, day, nowMin: 11 * 60 + 30, position: null, atStopId: null, doneStopIds: [] },
    });
  }
  {
    const { input, day } = dayInput('2026-10-27', (inp) => {
      const capitoline = inp.wishes.find((w) => w.id === 'capitoline');
      if (capitoline?.facts) capitoline.facts.closedDates = ['2026-10-27'];
    });
    cases.push({
      name: 'replan-closed-today',
      description:
        'The Capitoline turns out to be closed today (strike): drop it rather than walk to a shut door.',
      fn: 'replanDay',
      input: {
        ...input,
        day,
        nowMin: stop(day, 'trevi').departMin,
        position: null,
        atStopId: 'trevi',
        doneStopIds: ['navona', 'pantheon', 'spanish-steps'],
      },
    });
  }
  cases.push(...buildTripCaseInputs(), ...buildV21CaseInputs());
  return cases;
}

/** Rome with Wednesday 28 Oct marked light. */
export function lightWednesdayInput() {
  const rome = romeInput();
  rome.trip.dayLoads = { '2026-10-28': 'light' };
  return rome;
}

/** Rome plus a two-hour lunch in Trastevere on Thursday that IS lunch. */
export function longLunchInput(fixedDate: string | null = '2026-10-29') {
  const rome = romeInput();
  rome.wishes.push(
    makeWish(
      'trastevere-lunch',
      'Long lunch in Trastevere',
      { lat: 41.889, lng: 12.4693 },
      {
        priority: 'must',
        minutes: 120,
        hours: 'Mo-Su 12:00-15:30',
        fixedDate,
        replacesMeal: 'lunch',
        sortHint: 15,
      },
    ),
  );
  rome.matrix = estimateMatrix(romePoints(rome.wishes, rome.stays), rome.trip.modes);
  return rome;
}

/** v2.1: day loads and meal-replacing wishes. */
export function buildV21CaseInputs(): CaseInput[] {
  const cases: CaseInput[] = [
    {
      name: 'solve-light-wednesday',
      description:
        'Wednesday 28 Oct marked light: it ends 90 min earlier, takes about 60% of a normal day, and nothing is moved onto it.',
      fn: 'solveTrip',
      input: lightWednesdayInput(),
    },
    {
      name: 'solve-long-lunch-thursday',
      description:
        'A two-hour lunch in Trastevere on Thursday replaces lunch: one lunch-time stop, no automatic lunch that day.',
      fn: 'solveTrip',
      input: longLunchInput(),
    },
  ];
  {
    // The day was planned normal; Wednesday is then marked light mid-trip.
    const base = romeInput();
    const day = solveTrip(base).days.find((d) => d.date === '2026-10-28') as PlannedDay;
    const wishIds = new Set(day.stops.map((s) => s.wishId).filter((id): id is string => id !== null));
    cases.push({
      name: 'replan-light-day',
      description:
        'Wednesday marked light after it was planned: at the Colosseum on time, the evening in Trastevere now runs past the earlier end (17:30), so dropping it is offered.',
      fn: 'replanDay',
      input: {
        trip: { ...base.trip, dayLoads: { '2026-10-28': 'light' } },
        stays: base.stays,
        wishes: base.wishes.filter((w) => wishIds.has(w.id)),
        bookings: base.bookings.filter((b) => b.wishId !== null && wishIds.has(b.wishId)),
        matrix: sliceMatrix(base.matrix, [...wishIds, ...base.stays.map((s) => stayPoint(s.id))]),
        day,
        nowMin: day.stops.find((s) => s.id === 'colosseum')!.departMin,
        position: null,
        atStopId: 'colosseum',
        doneStopIds: [],
      },
    });
  }
  {
    const rome = longLunchInput();
    const day = solveTrip(rome).days.find((d) => d.date === '2026-10-29') as PlannedDay;
    const wishIds = new Set(day.stops.map((s) => s.wishId).filter((id): id is string => id !== null));
    const i = day.stops.findIndex((s) => s.id === 'trastevere-lunch');
    cases.push({
      name: 'retime-long-lunch-late',
      description:
        'Thursday: leaving the Vatican 45 minutes late, the long lunch (which replaces lunch) starts after 13:30 and warns as a late lunch.',
      fn: 'retimeDay',
      input: {
        trip: rome.trip,
        stays: rome.stays,
        wishes: rome.wishes.filter((w) => wishIds.has(w.id)),
        bookings: rome.bookings.filter((b) => b.wishId !== null && wishIds.has(b.wishId)),
        matrix: sliceMatrix(rome.matrix, [...wishIds, ...rome.stays.map((s) => stayPoint(s.id))]),
        day,
        fromIndex: i,
        startMin: day.stops[i - 1].departMin + 10 + 45,
      },
    });
  }
  return cases;
}

/**
 * Whole-trip cases: the full Rome input, the current plan's days and an
 * observation. Self-contained — the phone never needs solveTrip to replay.
 */
function tripInput(
  date: string,
  rest: Omit<TripReplanInput, 'trip' | 'stays' | 'wishes' | 'bookings' | 'matrix' | 'day' | 'plannedDays'>,
  edit?: (input: ReturnType<typeof romeInput>) => void,
): TripReplanInput {
  const rome = romeInput();
  edit?.(rome);
  const plan = solveTrip(rome);
  const day = plan.days.find((d) => d.date === date);
  if (!day) throw new Error(`No planned day ${date}`);
  return { ...rome, day, plannedDays: plan.days, ...rest };
}

function observe(
  kind: Observation['kind'],
  sinceMin: number,
  place: Observation['place'],
  stopId: string | null = null,
): Observation {
  return { kind, place, sinceMin, motion: 'stationary', stopId };
}

const NEAR_CASTEL: LatLng = { lat: 41.9019, lng: 12.4672 };
const NEAR_PINCIO: LatLng = { lat: 41.9095, lng: 12.4778 };
const AT_TREVI: LatLng = { lat: 41.9008, lng: 12.4832 };

export function buildTripCaseInputs(): CaseInput[] {
  return [
    {
      name: 'trip-unplanned-stop-pull-forward',
      description:
        "Tue 27 Oct, 11:00: sitting at a café by the Tiber since 10:40, a few minutes from Castel Sant'Angelo (planned for Fri 30 Oct). Pull it forward to now.",
      fn: 'replanTrip',
      input: tripInput('2026-10-27', {
        nowMin: 11 * 60,
        position: NEAR_CASTEL,
        atStopId: null,
        doneStopIds: ['navona', 'pantheon'],
        observation: observe('unplanned-stop', 10 * 60 + 40, {
          name: 'Caffè sul Tevere',
          location: NEAR_CASTEL,
        }),
      }),
    },
    {
      name: 'trip-missed-slot-resolve-rest',
      description:
        'Wed 28 Oct, 14:30, nothing done: the 09:30 Colosseum slot is missed and it can no longer fit today. Re-planning the rest of the trip moves it to a later day.',
      fn: 'replanTrip',
      input: tripInput('2026-10-28', {
        nowMin: 14 * 60 + 30,
        position: null,
        atStopId: null,
        doneStopIds: [],
        observation: observe('behind', 9 * 60 + 40, null),
      }),
    },
    {
      name: 'trip-out-of-order',
      description:
        'Tue 27 Oct, 10:00: after Piazza Navona they walked straight to the Trevi Fountain, a later stop of today. Do it now and carry on.',
      fn: 'replanTrip',
      input: tripInput('2026-10-27', {
        nowMin: 10 * 60,
        position: AT_TREVI,
        atStopId: null,
        doneStopIds: ['navona'],
        observation: observe(
          'out-of-order',
          9 * 60 + 55,
          { name: 'Trevi Fountain', location: AT_TREVI },
          'trevi',
        ),
      }),
    },
    {
      name: 'trip-taxi-vs-transit',
      description:
        'Taxi allowed: Thu 29 Oct, 08:40, still at the flat. The Vatican leg is too far to walk; a taxi (drive + 8 min pick-up) beats transit (15 min overhead).',
      fn: 'replanTrip',
      input: tripInput(
        '2026-10-29',
        { nowMin: 8 * 60 + 40, position: null, atStopId: null, doneStopIds: [], observation: null },
        (rome) => {
          rome.trip.modes = ['walk', 'transit', 'taxi'];
          rome.matrix = estimateMatrix(romePoints(rome.wishes, rome.stays), rome.trip.modes);
        },
      ),
    },
    {
      name: 'trip-stay-here-no-slack',
      description:
        "Fri 30 Oct, 11:00: after the Pincio they sat down at a bar since 10:20. Staying until 11:30 leaves no room before the 15:00 Borghese slot, so a nice goes (it's the last day).",
      fn: 'replanTrip',
      input: tripInput('2026-10-30', {
        nowMin: 11 * 60,
        position: NEAR_PINCIO,
        atStopId: null,
        doneStopIds: ['pincio'],
        observation: observe('unplanned-stop', 10 * 60 + 20, {
          name: 'Bar on the Pincio',
          location: NEAR_PINCIO,
        }),
      }),
    },
  ];
}
