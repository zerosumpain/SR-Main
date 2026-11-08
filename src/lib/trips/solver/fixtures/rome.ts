// src/lib/trips/solver/fixtures/rome.ts
//
// The Rome test trip (owner decision D3): four days, one stay near Campo de'
// Fiori, real places at real coordinates. OPENING HOURS, DURATIONS, BOOKING
// LEAD TIMES AND SLOTS ARE ILLUSTRATIVE — plausible for late October, not
// checked against the venues. The matrix is a distance × factor estimate
// (see ../estimate.ts), not routed.

import type {
  Booking,
  Facts,
  Stay,
  TransportSegment,
  TravelMatrix,
  TravelMode,
  Trip,
  Wish,
} from '../../model';
import { estimateMatrix } from '../estimate';
import { stayPoint } from '../matrix';
import { makeWish } from './build';

export const ROME_TRIP: Trip = {
  id: 'trip-rome',
  ownerEmail: 'owner@example.com',
  title: 'Rome in October',
  destination: 'Rome, Italy',
  timeZone: 'Europe/Rome',
  startDate: '2026-10-27',
  endDate: '2026-10-30',
  pace: 'normal',
  modes: ['walk', 'transit'],
  status: 'planned',
  notes: null,
};

export const ROME_STAY: Stay = {
  id: 'campo',
  name: "Apartment by Campo de' Fiori",
  address: 'Via dei Cappellari, Rome (illustrative)',
  location: { lat: 41.8952, lng: 12.4716 },
  fromDate: '2026-10-27',
  toDate: '2026-10-31',
  checkInMin: 15 * 60,
  checkOutMin: 10 * 60,
};

let hint = 0;
function wish(
  id: string,
  title: string,
  lat: number,
  lng: number,
  priority: Wish['priority'],
  minutes: number,
  hours: string | null,
  extra: Partial<Omit<Wish, 'facts'>> = {},
  facts: Partial<Facts> = {},
): Wish {
  hint += 1;
  return makeWish(id, title, { lat, lng }, { priority, minutes, hours, sortHint: hint, facts, ...extra });
}

const booked = { bookingRequired: true, bookAheadDays: 30 };

export const ROME_WISHES: Wish[] = [
  wish(
    'colosseum',
    'Colosseum and Roman Forum',
    41.8902,
    12.4922,
    'must',
    180,
    'Mo-Su 08:30-17:00',
    {},
    booked,
  ),
  wish('vatican', 'Vatican Museums', 41.9065, 12.4536, 'must', 210, 'Mo-Sa 08:00-19:00; Su off', {}, booked),
  wish(
    'borghese',
    'Borghese Gallery',
    41.9142,
    12.4921,
    'must',
    120,
    'Tu-Su 09:00-19:00; Mo off',
    {},
    booked,
  ),
  wish('st-peters', "St Peter's Basilica", 41.9022, 12.4539, 'must', 75, 'Mo-Su 07:00-19:00'),
  wish('pantheon', 'Pantheon', 41.8986, 12.4769, 'must', 45, 'Mo-Su 09:00-19:00'),
  wish('trevi', 'Trevi Fountain', 41.9009, 12.4833, 'must', 20, '24/7'),
  wish('navona', 'Piazza Navona', 41.8992, 12.4731, 'must', 30, '24/7'),
  wish('castel', "Castel Sant'Angelo", 41.9031, 12.4663, 'nice', 90, 'Tu-Su 09:00-19:30; Mo off'),
  wish('capitoline', 'Capitoline Museums', 41.893, 12.4828, 'nice', 120, 'Mo-Su 09:30-19:30'),
  wish('campo-market', "Campo de' Fiori market", 41.8956, 12.4722, 'nice', 30, 'Mo-Sa 07:00-14:00; Su off', {
    partOfDay: 'morning',
  }),
  wish('spanish-steps', 'Spanish Steps', 41.9058, 12.4823, 'nice', 30, '24/7'),
  wish('trastevere', 'Trastevere in the evening', 41.8894, 12.47, 'nice', 90, '24/7', {
    partOfDay: 'evening',
  }),
  wish('ghetto', "Jewish Ghetto and Portico d'Ottavia", 41.8925, 12.4777, 'nice', 45, '24/7'),
  wish('pincio', 'Pincio terrace, Villa Borghese', 41.9113, 12.4797, 'nice', 45, '24/7'),
];

export const ROME_BOOKINGS: Booking[] = [
  {
    id: 'bk-colosseum',
    wishId: 'colosseum',
    title: 'Colosseum, Forum and Palatine — timed entry',
    date: '2026-10-28',
    startMin: 9 * 60 + 30,
    endMin: null,
    reference: 'ILLUSTRATIVE-1',
    url: null,
    documentId: null,
    status: 'booked',
  },
  {
    id: 'bk-vatican',
    wishId: 'vatican',
    title: 'Vatican Museums — timed entry',
    date: '2026-10-29',
    startMin: 9 * 60,
    endMin: null,
    reference: 'ILLUSTRATIVE-2',
    url: null,
    documentId: null,
    status: 'booked',
  },
  {
    id: 'bk-borghese',
    wishId: 'borghese',
    title: 'Borghese Gallery — two-hour slot',
    date: '2026-10-30',
    startMin: 15 * 60,
    endMin: 17 * 60,
    reference: 'ILLUSTRATIVE-3',
    url: null,
    documentId: null,
    status: 'booked',
  },
];

export function romePoints(wishes: Wish[] = ROME_WISHES, stays: Stay[] = [ROME_STAY]) {
  return [
    ...wishes
      .filter((w) => w.place)
      .map((w) => ({
        id: w.id,
        location: (w.place as NonNullable<Wish['place']>).location,
      })),
    ...stays.map((s) => ({ id: stayPoint(s.id), location: s.location })),
  ];
}

export const ROME_MATRIX: TravelMatrix = estimateMatrix(romePoints(), ROME_TRIP.modes);

/** A fresh copy of the whole Rome solver input. */
export function romeInput() {
  return JSON.parse(
    JSON.stringify({
      trip: ROME_TRIP,
      stays: [ROME_STAY],
      wishes: ROME_WISHES,
      bookings: ROME_BOOKINGS,
      matrix: ROME_MATRIX,
    }),
  ) as {
    trip: Trip;
    stays: Stay[];
    wishes: Wish[];
    bookings: Booking[];
    matrix: TravelMatrix;
  };
}

// ── v3: getting there and back (ILLUSTRATIVE flights and transfer times) ────

const FIUMICINO = { lat: 41.8003, lng: 12.2389 };

export const ROME_TRANSPORT: TransportSegment[] = [
  {
    id: 'out',
    kind: 'flight',
    direction: 'outbound',
    carrier: 'Jet2',
    number: 'LS1235',
    from: {
      name: 'Newcastle',
      code: 'NCL',
      location: { lat: 55.0375, lng: -1.6917 },
      timeZone: 'Europe/London',
    },
    to: { name: 'Rome Fiumicino', code: 'FCO', location: FIUMICINO, timeZone: 'Europe/Rome' },
    departDate: '2026-10-27',
    departMin: 7 * 60 + 35,
    arriveDate: '2026-10-27',
    arriveMin: 11 * 60 + 5,
    confidence: 'stated',
    status: 'scheduled',
    delayMin: null,
    bookingRef: null,
    sources: [],
    checkedAt: null,
  },
  {
    id: 'back',
    kind: 'flight',
    direction: 'return',
    carrier: 'Jet2',
    number: 'LS1236',
    from: { name: 'Rome Fiumicino', code: 'FCO', location: FIUMICINO, timeZone: 'Europe/Rome' },
    to: {
      name: 'Newcastle',
      code: 'NCL',
      location: { lat: 55.0375, lng: -1.6917 },
      timeZone: 'Europe/London',
    },
    departDate: '2026-10-30',
    departMin: 18 * 60 + 40,
    arriveDate: '2026-10-30',
    arriveMin: 20 * 60 + 40,
    confidence: 'stated',
    status: 'scheduled',
    delayMin: null,
    bookingRef: null,
    sources: [],
    checkedAt: null,
  },
];

/**
 * The Rome trip with flights: check-in 15:00 / check-out 10:00, the Borghese
 * slot moved to Friday 10:00 (the 15:00 slot would clash with the flight
 * home), and the matrix extended with the airport. Airport transfers are
 * set by hand — Leonardo Express + a short hop ≈ 60 min, a taxi ≈ 50 min —
 * because the city estimate factors don't fit a 30 km airport run.
 */
export function romeTransportInput(delayMin: number | null = null) {
  const input = romeInput();
  input.stays[0].checkInMin = 15 * 60;
  input.stays[0].checkOutMin = 10 * 60;
  const borghese = input.bookings.find((b) => b.id === 'bk-borghese');
  if (borghese) {
    borghese.startMin = 10 * 60;
    borghese.endMin = 12 * 60;
  }
  const transport: TransportSegment[] = JSON.parse(JSON.stringify(ROME_TRANSPORT));
  transport[0].delayMin = delayMin;
  if (delayMin) transport[0].status = 'delayed';
  const points = [
    ...romePoints(input.wishes, input.stays),
    { id: 'transport:out:to', location: FIUMICINO },
    { id: 'transport:back:from', location: FIUMICINO },
  ];
  const matrix = estimateMatrix(points, ['walk', 'transit', 'taxi']);
  const airport = new Set(['transport:out:to', 'transport:back:from']);
  const AIRPORT_SEC: Partial<Record<TravelMode, number>> = { transit: 60 * 60, drive: 50 * 60 };
  points.forEach((a, i) =>
    points.forEach((b, j) => {
      if (i === j || airport.has(a.id) === airport.has(b.id)) return;
      for (const mode of ['transit', 'drive'] as const) {
        const row = matrix.seconds[mode];
        if (row) row[i][j] = AIRPORT_SEC[mode] as number;
      }
      const walk = matrix.seconds.walk;
      if (walk) walk[i][j] = null; // nobody walks from the airport
    }),
  );
  return { ...input, matrix, transport };
}
