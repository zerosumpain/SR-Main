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
  PlannedStop,
  ReplanOption,
  SolvedPlan,
  TripReplanOption,
} from '../../../model';
import { estimateMatrix } from '../../estimate';
import { fmtMin } from '../../calendar';
import {
  solveTrip,
  type ReplanInput,
  type RetimeInput,
  type SolverInput,
  type TripReplanInput,
} from '../../index';
import { makeWish } from '../build';
import { sliceMatrix, stayPoint } from '../../matrix';
import { romeInput, romePoints, romeTransportInput } from '../rome';

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

/** A day's sights (wish stops) in planned order. */
function sightsOf(day: PlannedDay) {
  return day.stops.filter((s) => s.kind === 'wish');
}

/** The next stop that starts after a given one (for "set off towards"). */
function nextAfter(day: PlannedDay, stopId: string) {
  return day.stops[indexOf(day, stopId) + 1];
}

/**
 * The cases pick their stops from the planned day by position, so they keep
 * their meaning when the plan changes; descriptions name the actual stops.
 */
export function buildCaseInputs(): CaseInput[] {
  const cases: CaseInput[] = [];
  const BUFFER = 10;

  {
    const { input, day } = dayInput('2026-10-27');
    const [, second] = sightsOf(day);
    const next = nextAfter(day, second.id);
    cases.push({
      name: 'retime-running-late',
      description: `Leave ${second.title} 25 minutes late; the rest of the day slides back in the same order.`,
      fn: 'retimeDay',
      input: { ...input, day, fromIndex: indexOf(day, next.id), startMin: second.departMin + BUFFER + 25 },
    });
  }
  {
    const { input, day } = dayInput('2026-10-28');
    cases.push({
      name: 'retime-late-start-booked-slot',
      description:
        'Leave the stay at 09:30 on Colosseum day (breakfast just before): the 09:30 slot is missed, so a warning, not a move.',
      fn: 'retimeDay',
      input: { ...input, day, fromIndex: 0, startMin: 9 * 60 + 30 },
    });
  }
  {
    const { input, day } = dayInput('2026-10-30');
    const slot = stop(day, 'borghese');
    const before = day.stops[indexOf(day, 'borghese') - 1];
    const slack = Math.max(1, Math.min(10, Math.round(slot.waitSec / 60) - 1));
    cases.push({
      name: 'retime-locked-slot-absorbs-delay',
      description: `Leave ${before.title.toLowerCase() === 'lunch' ? 'lunch' : before.title} ${slack} minutes late; the 15:00 Borghese slot stays put and the wait before it shrinks.`,
      fn: 'retimeDay',
      input: {
        ...input,
        day,
        fromIndex: indexOf(day, 'borghese'),
        startMin: before.departMin + (before.kind === 'meal' ? 0 : BUFFER) + slack,
      },
    });
  }
  {
    const { input, day } = dayInput('2026-10-27');
    const [first] = sightsOf(day);
    cases.push({
      name: 'replan-on-time',
      description: `At ${first.title} exactly on time: carry on as planned.`,
      fn: 'replanDay',
      input: { ...input, day, nowMin: first.departMin, position: null, atStopId: first.id, doneStopIds: [] },
    });
  }
  {
    const { input, day } = dayInput('2026-10-27');
    // The first sight, overstayed by 150 minutes.
    const at = sightsOf(day)[0];
    const done: PlannedStop[] = [];
    cases.push({
      name: 'replan-running-late',
      description: `Still at ${at.title} 150 minutes after leaving was planned: push back or drop a nice.`,
      fn: 'replanDay',
      input: {
        ...input,
        day,
        nowMin: at.departMin + BUFFER + 150,
        position: null,
        atStopId: at.id,
        doneStopIds: done.map((s) => s.id),
      },
    });
  }
  {
    const { input, day } = dayInput('2026-10-27');
    const [a, b, c] = sightsOf(day);
    const near = c.location as LatLng;
    cases.push({
      name: 'replan-skipped-stop',
      description: `Skipped ${a.title} and ${b.title}; walking near ${c.title} at ${fmtMin(a.arriveMin - 4)}.`,
      fn: 'replanDay',
      input: {
        ...input,
        day,
        nowMin: a.arriveMin - 4,
        position: { lat: near.lat + 0.0005, lng: near.lng - 0.0004 },
        atStopId: null,
        doneStopIds: [a.id, b.id],
      },
    });
  }
  {
    const { input, day } = dayInput('2026-10-30');
    const [first] = sightsOf(day);
    cases.push({
      name: 'replan-locked-slot',
      description: `Still at ${first.title} 40 minutes late: whatever the option, the 15:00 Borghese slot stays at 15:00.`,
      fn: 'replanDay',
      input: {
        ...input,
        day,
        nowMin: first.departMin + BUFFER + 40,
        position: null,
        atStopId: first.id,
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
    // Close today the first nice still ahead after the first sight.
    const base = dayInput('2026-10-27');
    const [first, ...rest] = sightsOf(base.day);
    const wishes = new Map(base.input.wishes.map((w) => [w.id, w]));
    const shut = rest.find((s) => wishes.get(s.wishId as string)?.priority === 'nice') as PlannedStop;
    const { input, day } = dayInput('2026-10-27', (inp) => {
      const w = inp.wishes.find((x) => x.id === shut.wishId);
      if (w?.facts) w.facts.closedDates = ['2026-10-27'];
    });
    cases.push({
      name: 'replan-closed-today',
      description: `${shut.title} turns out to be closed today (strike): drop it rather than walk to a shut door.`,
      fn: 'replanDay',
      input: { ...input, day, nowMin: first.departMin, position: null, atStopId: first.id, doneStopIds: [] },
    });
  }
  cases.push(...buildTripCaseInputs(), ...buildV21CaseInputs(), ...buildV3CaseInputs());
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

/** The preview's Rome: light Wednesday, long lunch Thursday, Pincio (2 h) pinned to Friday. */
export function pinnedFridayInput() {
  const rome = longLunchInput();
  rome.trip.dayLoads = { '2026-10-28': 'light' };
  const pincio = rome.wishes.find((w) => w.id === 'pincio');
  if (pincio) {
    pincio.fixedDate = '2026-10-30';
    pincio.durationSec = 120 * 60;
  }
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
      name: 'solve-pinned-friday',
      description:
        "Light Wednesday + the long Thursday lunch + a two-hour sunset at the Pincio terrace pinned to Friday: Friday overflows, so an unpinned nice (Campo de' Fiori market) goes and the pinned Pincio stays.",
      fn: 'solveTrip',
      input: pinnedFridayInput(),
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
        'Wednesday marked light after it was planned, at the Colosseum on time: sightseeing must end by 17:30 and the day by 20:30, and the evening in Trastevere (an evening wish) still fits before dinner — carry on.',
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

export function buildTripCaseInputs(): CaseInput[] {
  const plan = solveTrip(romeInput());
  const day = (date: string) => plan.days.find((d) => d.date === date) as PlannedDay;
  const doneBy = (d: PlannedDay, min: number) =>
    d.stops
      .filter((s) => (s.kind === 'wish' || s.id.endsWith(':lunch')) && s.departMin <= min)
      .map((s) => s.id);
  const names = (d: PlannedDay, ids: string[]) =>
    ids.map((id) => d.stops.find((s) => s.id === id)?.title ?? id).join(' and ') || 'breakfast';

  const tue = day('2026-10-27');
  const [a, b, c] = sightsOf(tue);
  const tueDone = doneBy(tue, 10 * 60 + 40);
  const fri = day('2026-10-30');
  const friDone = doneBy(fri, 10 * 60 + 20);
  const atC = c.location as LatLng;
  return [
    {
      name: 'trip-unplanned-stop-pull-forward',
      description: `Tue 27 Oct, 11:00: after ${names(tue, tueDone)}, sitting at a café by the Tiber since 10:40, a few minutes from Castel Sant'Angelo (planned for Fri 30 Oct). Pull it forward to now.`,
      fn: 'replanTrip',
      input: tripInput('2026-10-27', {
        nowMin: 11 * 60,
        position: NEAR_CASTEL,
        atStopId: null,
        doneStopIds: tueDone,
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
      description: `Tue 27 Oct, ${fmtMin(b.arriveMin)}: after ${a.title} they went straight to ${c.title}, a later stop of today. Do it now and carry on.`,
      fn: 'replanTrip',
      input: tripInput('2026-10-27', {
        nowMin: b.arriveMin,
        position: atC,
        atStopId: null,
        doneStopIds: [a.id],
        observation: observe('out-of-order', b.arriveMin - 5, { name: c.title, location: atC }, c.id),
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
      description: `Fri 30 Oct, 11:00: after ${names(fri, friDone)} they sat down at a bar near the Pincio at 10:20. Staying until 11:30 leaves too little room before the 15:00 Borghese slot, so a nice goes (it's the last day).`,
      fn: 'replanTrip',
      input: tripInput('2026-10-30', {
        nowMin: 11 * 60,
        position: NEAR_PINCIO,
        atStopId: null,
        doneStopIds: friDone,
        observation: observe('unplanned-stop', 10 * 60 + 20, {
          name: 'Bar on the Pincio',
          location: NEAR_PINCIO,
        }),
      }),
    },
  ];
}

/** v3: flights there and back frame the first and last days. */
export function buildV3CaseInputs(): CaseInput[] {
  const plan = solveTrip(romeTransportInput());
  const first = plan.days[0];
  const delayed = romeTransportInput(120);
  return [
    {
      name: 'solve-flights-rome',
      description:
        'LS1235 Newcastle 07:35 → Rome 11:05, check-in 15:00: transfer, drop bags, lunch near the stay and sights before check-in. LS1236 home at 18:40: check out in the morning, back for bags by ~15:30, leave for the airport at 15:40.',
      fn: 'solveTrip',
      input: romeTransportInput(),
    },
    {
      name: 'replan-arrival-delayed',
      description:
        'The outbound flight is 2 h late (lands 13:05): the arrival day is re-framed from the new landing; lunch is past its window, so it is skipped with a warning.',
      fn: 'replanDay',
      input: {
        ...delayed,
        day: first,
        nowMin: 12 * 60 + 30,
        position: null,
        atStopId: null,
        doneStopIds: [],
      },
    },
    {
      name: 'trip-arrival-delayed',
      description:
        'The same 2 h delay, re-planning the whole trip: what no longer fits on the arrival day moves to a later day.',
      fn: 'replanTrip',
      input: {
        ...delayed,
        day: first,
        plannedDays: plan.days,
        nowMin: 12 * 60 + 30,
        position: null,
        atStopId: null,
        doneStopIds: [],
        observation: { kind: 'behind', place: null, sinceMin: 11 * 60 + 5, motion: 'unknown', stopId: null },
      },
    },
  ];
}
