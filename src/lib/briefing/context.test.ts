import { describe, expect, it } from 'vitest';
import {
  openTasks,
  orderTransports,
  pickNextTrip,
  pickTodayTrip,
  placeLabel,
  safeTimeZone,
  stayForDay,
  stopsForDay,
  summariseMessages,
  toBriefingTransport,
  tripDay,
  type TripCandidate,
} from './context';
import type { SolvedPlan, Stay } from '$lib/trips/model';

// Every fixture is synthetic.

const trip = (over: Partial<TripCandidate> & { id: string }): TripCandidate => ({
  status: 'planned',
  startDate: '2026-10-26',
  endDate: '2026-10-30',
  planVersion: null,
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('pickTodayTrip', () => {
  it('prefers the active trip over an overlapping planned one', () => {
    const trips = [trip({ id: 'planned', status: 'planned', planVersion: 4 }), trip({ id: 'active', status: 'active' })];
    expect(pickTodayTrip(trips, '2026-10-27')?.id).toBe('active');
  });

  it('breaks a status tie on a plan, then on journeys', () => {
    expect(pickTodayTrip([trip({ id: 'bare' }), trip({ id: 'plan', planVersion: 1 })], '2026-10-27')?.id).toBe('plan');
    expect(
      pickTodayTrip([trip({ id: 'bare', transportCount: 0 }), trip({ id: 'flights', transportCount: 2 })], '2026-10-27')?.id,
    ).toBe('flights');
  });

  it('never returns a cancelled, archived or deleted trip, nor one not covering today', () => {
    const trips = [
      trip({ id: 'c', status: 'cancelled' }),
      trip({ id: 'a', status: 'archived' }),
      trip({ id: 'd', status: 'deleted' }),
      trip({ id: 'later', startDate: '2026-11-02', endDate: '2026-11-05' }),
    ];
    expect(pickTodayTrip(trips, '2026-10-27')).toBeNull();
  });

  it('counts the first and last days as on the trip', () => {
    expect(pickTodayTrip([trip({ id: 'x' })], '2026-10-26')?.id).toBe('x');
    expect(pickTodayTrip([trip({ id: 'x' })], '2026-10-30')?.id).toBe('x');
    expect(pickTodayTrip([trip({ id: 'x' })], '2026-10-31')).toBeNull();
  });
});

describe('pickNextTrip', () => {
  it('takes the soonest live trip within 14 days', () => {
    const trips = [
      trip({ id: 'far', startDate: '2026-11-20', endDate: '2026-11-22' }),
      trip({ id: 'second', startDate: '2026-11-05', endDate: '2026-11-07' }),
      trip({ id: 'first', startDate: '2026-11-01', endDate: '2026-11-03' }),
      trip({ id: 'gone', status: 'cancelled', startDate: '2026-10-28', endDate: '2026-10-29' }),
    ];
    expect(pickNextTrip(trips, '2026-10-27')?.id).toBe('first');
    expect(pickNextTrip(trips, '2026-11-06')?.id).toBe('far');
    expect(pickNextTrip(trips, '2026-11-20')).toBeNull();
  });
});

describe('tripDay', () => {
  it('numbers the days of a trip under way', () => {
    expect(tripDay('2026-10-26', '2026-10-30', '2026-10-27')).toEqual({ dayIndex: 2, dayCount: 5, daysUntil: 0 });
  });
  it('is day 0 with a countdown before it starts', () => {
    expect(tripDay('2026-11-01', '2026-11-03', '2026-10-27')).toEqual({ dayIndex: 0, dayCount: 3, daysUntil: 5 });
  });
});

describe('stopsForDay', () => {
  const plan = {
    days: [
      { date: '2026-10-26', stops: [{ title: 'Arrive', kind: 'transport', arriveMin: 600 }] },
      {
        date: '2026-10-27',
        stops: [
          { title: 'Hotel', kind: 'stay', arriveMin: 480 },
          { title: 'Colosseum', kind: 'wish', arriveMin: 570, departMin: 690 },
          { title: 'Lunch', kind: 'meal', arriveMin: 'noon' },
          { title: '', kind: 'wish', arriveMin: 900 },
        ],
      },
    ],
  } as unknown as SolvedPlan;

  it("returns today's stops in order, with a missing time as null", () => {
    expect(stopsForDay(plan, '2026-10-27')).toEqual([
      { title: 'Hotel', kind: 'stay', arriveMin: 480 },
      { title: 'Colosseum', kind: 'wish', arriveMin: 570 },
      { title: 'Lunch', kind: 'meal', arriveMin: null },
    ]);
  });

  it('is empty for a day off the plan or no plan at all', () => {
    expect(stopsForDay(plan, '2026-10-29')).toEqual([]);
    expect(stopsForDay(null, '2026-10-27')).toEqual([]);
    expect(stopsForDay({} as SolvedPlan, '2026-10-27')).toEqual([]);
  });
});

describe('transports', () => {
  it('renders a place as "Name (CODE)"', () => {
    expect(placeLabel({ name: 'Rome Fiumicino Airport', code: 'FCO', location: null, timeZone: 'Europe/Rome' })).toBe(
      'Rome Fiumicino Airport (FCO)',
    );
    expect(placeLabel({ name: 'Leeds Bradford Airport (LBA)', code: 'LBA' })).toBe('Leeds Bradford Airport (LBA)');
    expect(placeLabel({ name: 'Roma Termini', code: null })).toBe('Roma Termini');
    expect(placeLabel({ code: 'FCO' })).toBe('FCO');
    expect(placeLabel(null)).toBeNull();
  });

  it('maps a stored segment and orders by departure', () => {
    const back = toBriefingTransport({
      kind: 'flight',
      direction: 'return',
      carrier: 'Jet2',
      number: 'LS1236',
      from: { name: 'Rome Fiumicino Airport', code: 'FCO', location: null, timeZone: 'Europe/Rome' },
      to: { name: 'Leeds Bradford Airport', code: 'LBA', location: null, timeZone: 'Europe/London' },
      departDate: '2026-10-30',
      departMin: 1080,
      arriveDate: '2026-10-30',
      arriveMin: 1215,
      status: null,
      delayMin: null,
    });
    const out = toBriefingTransport({ kind: 'flight', direction: 'outbound', from: 'LBA', to: null, departDate: '2026-10-26', departMin: 420 });
    expect(back).toEqual({
      kind: 'flight',
      direction: 'return',
      carrier: 'Jet2',
      number: 'LS1236',
      from: 'Rome Fiumicino Airport (FCO)',
      to: 'Leeds Bradford Airport (LBA)',
      departDate: '2026-10-30',
      departMin: 1080,
      arriveDate: '2026-10-30',
      arriveMin: 1215,
      status: null,
      delayMin: null,
    });
    expect(out.from).toBe('LBA');
    expect(out.carrier).toBeNull();
    expect(orderTransports([back, out]).map((t) => t.direction)).toEqual(['outbound', 'return']);
  });
});

describe('stayForDay', () => {
  const stay = (name: string, fromDate: string, toDate: string): Stay =>
    ({ id: name, name, address: null, location: { lat: 41.9, lng: 12.5 }, fromDate, toDate, checkInMin: null, checkOutMin: null }) as Stay;

  it('picks the stay covering the night, else the first', () => {
    const stays = [stay('A', '2026-10-26', '2026-10-28'), stay('B', '2026-10-28', '2026-10-30')];
    expect(stayForDay(stays, '2026-10-27')?.name).toBe('A');
    expect(stayForDay(stays, '2026-10-28')?.name).toBe('B');
    expect(stayForDay(stays, '2026-10-30')?.name).toBe('B');
    expect(stayForDay(stays, '2026-11-15')?.name).toBe('A');
    expect(stayForDay([], '2026-10-27')).toBeNull();
  });
});

describe('family', () => {
  const now = new Date('2026-10-27T06:00:00Z');
  const owner = (e: string) => e === 'owner@example.test';
  const msg = (fromEmail: string, fromName: string, body: string, hoursAgo: number) => ({
    fromEmail,
    fromName,
    body,
    createdAt: new Date(now.getTime() - hoursAgo * 3_600_000),
  });

  it("counts the last 24h of other people's messages, newest first", () => {
    const out = summariseMessages(
      [
        msg('owner@example.test', 'John Smith', 'mine', 1),
        msg('ann@example.test', 'Ann Smith', 'older', 5),
        msg('bob@example.test', 'Bob', 'x'.repeat(300), 2),
        msg('ann@example.test', 'Ann Smith', 'again', 3),
        msg('cat@example.test', 'Cat', 'two days ago', 48),
      ],
      owner,
      now,
    );
    expect(out.messagesOvernight).toBe(3);
    expect(out.lastFrom).toEqual(['Bob', 'Ann']);
    expect(out.latestText?.length).toBe(140);
  });

  it('is zero and null with nothing overnight', () => {
    expect(summariseMessages([], owner, now)).toEqual({ messagesOvernight: 0, lastFrom: [], latestText: null });
  });

  it('lists open tasks, soonest deadline first, at most six', () => {
    const task = (title: string, deadline: string | null, status = 'open', assigneeEmail: string | null = null) => ({
      title,
      deadline,
      assigneeEmail,
      status,
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });
    const out = openTasks(
      [
        task('undated', null),
        task('done', '2026-10-01', 'done'),
        task('soon', '2026-10-28', 'open', 'ann@example.test'),
        ...Array.from({ length: 6 }, (_, i) => task(`t${i}`, `2026-11-0${i + 1}`)),
      ],
      () => 'Ann Smith',
    );
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ title: 'soon', due: '2026-10-28', who: 'Ann' });
    expect(out.map((t) => t.title)).not.toContain('done');
    expect(out.map((t) => t.title)).not.toContain('undated');
  });
});

describe('safeTimeZone', () => {
  it('keeps a real zone and falls back otherwise', () => {
    expect(safeTimeZone('Europe/Rome')).toBe('Europe/Rome');
    expect(safeTimeZone('Not/AZone')).toBe('Europe/London');
    expect(safeTimeZone(null)).toBe('Europe/London');
  });
});
