// src/lib/trips/solver/fixtures/cases/build.ts
//
// Builds the inputs of the shared re-timing / re-planning cases from the
// Rome trip. The JSON files beside this are these inputs plus the TS
// solver's answers; the iPhone app replays the same JSON against its Swift
// port. Regenerate with `TRIPS_WRITE_CASES=1 npx vitest run
// src/lib/trips/solver/cases.test.ts` — only when a behaviour change is
// intended, and port it to Swift too.

import type { LatLng, Observation, PlannedDay, ReplanOption, TripReplanOption } from '../../../model';
import { estimateMatrix } from '../../estimate';
import { solveTrip, type ReplanInput, type RetimeInput, type TripReplanInput } from '../../index';
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
  | Omit<Extract<SolverCase, { fn: 'replanTrip' }>, 'expected'>;

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
  cases.push(...buildTripCaseInputs());
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
