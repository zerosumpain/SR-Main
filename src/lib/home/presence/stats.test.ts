import { describe, expect, it } from 'vitest';
import type { Journey } from './journeys';
import type { MovementMode } from './types';
import { circularMedianMinute, hhmm, localWeekStart, modeBucket, movementStats, type StatsVisit } from './stats';

// Journeys are built directly — the segmenter has its own tests. No
// coordinates are needed here at all.
function journey(start: string, minutes: number, km: number, mode: MovementMode | null): Journey {
  const startedAt = new Date(start);
  return {
    subject: 'alex',
    startedAt,
    endedAt: new Date(startedAt.getTime() + minutes * 60_000),
    minutes,
    distanceKm: km,
    meanSpeedKmh: minutes ? km / (minutes / 60) : null,
    maxSpeedKmh: null,
    dominantMode: mode,
    fixCount: 10,
    fromPlaceId: null,
    toPlaceId: null,
  };
}

/** A walk of `km` at exactly `mps` metres a second. */
function walkAt(start: string, km: number, mps: number, mode: MovementMode = 'walking'): Journey {
  const j = journey(start, 0, km, mode);
  const secs = (km * 1000) / mps;
  j.endedAt = new Date(j.startedAt.getTime() + secs * 1000);
  j.minutes = Math.round(secs / 60);
  return j;
}

function visit(placeId: string, label: string | null, from: string, to: string): StatsVisit {
  return { placeId, label, from: new Date(from), to: new Date(to) };
}

const NOW = new Date('2026-10-28T12:00:00Z');
const OPTS = { days: 30, now: NOW };

describe('mode buckets (inferred from speed)', () => {
  it('maps walking to foot, vehicle to car or rail, and the rest to other', () => {
    const rail = journey('2026-10-20T08:00:00Z', 30, 40, 'vehicle');
    const isRail = (j: Journey) => j === rail;
    expect(modeBucket(journey('2026-10-20T08:00:00Z', 20, 1.5, 'walking'))).toBe('foot');
    expect(modeBucket(journey('2026-10-20T08:00:00Z', 20, 15, 'vehicle'), isRail)).toBe('car');
    expect(modeBucket(rail, isRail)).toBe('rail');
    expect(modeBucket(journey('2026-10-20T08:00:00Z', 20, 30, 'rail'))).toBe('rail');
    expect(modeBucket(journey('2026-10-20T08:00:00Z', 20, 4, 'active'))).toBe('other');
    expect(modeBucket(journey('2026-10-20T08:00:00Z', 20, 4, null))).toBe('other');
    expect(modeBucket(journey('2026-10-20T08:00:00Z', 20, 4, 'unknown'))).toBe('other');
  });

  it('totals count, metres and seconds per bucket, inside the window only', () => {
    const rail = journey('2026-10-21T08:00:00Z', 30, 40, 'vehicle');
    const s = movementStats(
      [
        journey('2026-10-20T08:00:00Z', 20, 1.5, 'walking'),
        journey('2026-10-20T09:00:00Z', 10, 1, 'walking'),
        journey('2026-10-20T10:00:00Z', 15, 12, 'vehicle'),
        rail,
        journey('2026-10-22T10:00:00Z', 20, 5, 'active'),
        journey('2026-09-01T10:00:00Z', 20, 5, 'walking'), // before the window
      ],
      [],
      { ...OPTS, isRail: (j) => j === rail },
    );
    expect(s.byMode.foot).toEqual({ count: 2, metres: 2500, seconds: 1800 });
    expect(s.byMode.car).toEqual({ count: 1, metres: 12000, seconds: 900 });
    expect(s.byMode.rail).toEqual({ count: 1, metres: 40000, seconds: 1800 });
    expect(s.byMode.other).toEqual({ count: 1, metres: 5000, seconds: 1200 });
  });
});

describe('walking pace', () => {
  it('keeps foot journeys ≥ 500 m averaging 0.9–2.5 m/s, bounds inclusive', () => {
    const s = movementStats(
      [
        walkAt('2026-10-20T08:00:00Z', 1, 0.9), // in: lower bound
        walkAt('2026-10-20T09:00:00Z', 1, 2.5), // in: upper bound
        walkAt('2026-10-20T10:00:00Z', 0.5, 1.4), // in: exactly 500 m
        walkAt('2026-10-20T11:00:00Z', 1, 0.89), // out: a dawdle
        walkAt('2026-10-20T12:00:00Z', 1, 2.51), // out: a jog
        walkAt('2026-10-20T13:00:00Z', 0.49, 1.4), // out: too short
        walkAt('2026-10-20T14:00:00Z', 2, 1.4, 'active'), // out: not foot
      ],
      [],
      OPTS,
    );
    expect(s.walkingPace?.n).toBe(3);
    expect(s.walkingPace?.medianMps).toBe(1.4);
    // p75 of [0.9, 1.4, 2.5], interpolated: 1.4 + 0.5 × 1.1.
    expect(s.walkingPace?.p75Mps).toBe(1.95);
  });

  it('is null when no walk qualifies', () => {
    expect(movementStats([walkAt('2026-10-20T08:00:00Z', 0.3, 1.4)], [], OPTS).walkingPace).toBeNull();
  });

  it('buckets weeks from Monday on the local clock, across the October clock change', () => {
    // 2026-10-19 00:30 BST is Sunday 23:30 UTC — a UTC week would file it a week early.
    expect(localWeekStart(new Date('2026-10-18T23:30:00Z'))).toBe('2026-10-19');
    // Sunday 25 Oct 23:30 GMT (after the change) is still the week of the 19th…
    expect(localWeekStart(new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-19');
    // …and Monday 00:30 GMT starts the next.
    expect(localWeekStart(new Date('2026-10-26T00:30:00Z'))).toBe('2026-10-26');

    const s = movementStats(
      [
        walkAt('2026-10-18T23:30:00Z', 1, 1.2),
        walkAt('2026-10-25T23:30:00Z', 1, 1.6),
        walkAt('2026-10-26T00:30:00Z', 1, 1.5),
      ],
      [],
      OPTS,
    );
    expect(s.walkingPace?.weekly).toEqual([
      { weekStart: '2026-10-19', medianMps: 1.4, n: 2 },
      { weekStart: '2026-10-26', medianMps: 1.5, n: 1 },
    ]);
  });
});

describe('common trips', () => {
  /** Home → Work on a given day, leaving at `hhmmUtc`, `mins` long. */
  function commute(day: string, hhmmUtc: string, mins: number, mode: MovementMode = 'vehicle') {
    const start = new Date(`${day}T${hhmmUtc}:00Z`);
    const end = new Date(start.getTime() + mins * 60_000);
    const iso = (d: Date, dm: number) => new Date(d.getTime() + dm * 60_000).toISOString();
    return {
      j: journey(start.toISOString(), mins, 8, mode),
      v: [visit('p-home', 'Home', iso(start, -600), iso(start, -2)), visit('p-work', 'Work', iso(end, 3), iso(end, 480))],
    };
  }

  it('groups labelled pairs seen three times, with usual departure, median time and mode', () => {
    const a = commute('2026-10-20', '07:10', 20);
    const b = commute('2026-10-21', '07:20', 30);
    const c = commute('2026-10-22', '07:30', 25, 'walking');
    const s = movementStats([a.j, b.j, c.j], [...a.v, ...b.v, ...c.v], OPTS);
    expect(s.commonTrips).toEqual([
      // 07:20 UTC is 08:20 BST: the departure is on the house's clock.
      { fromLabel: 'Home', toLabel: 'Work', count: 3, usualDeparture: '08:20', medianSeconds: 1500, mode: 'car' },
    ]);
  });

  it('takes the usual departure on a clock: 23:50, 00:00 and 00:10 is midnight, not noon', () => {
    expect(hhmm(circularMedianMinute([23 * 60 + 50, 10, 0]))).toBe('00:00');
    expect(hhmm(circularMedianMinute([23 * 60 + 50, 10]))).toBe('00:00');
    expect(hhmm(circularMedianMinute([7 * 60, 8 * 60, 9 * 60]))).toBe('08:00');

    // Through movementStats: GMT days, so UTC equals local.
    const trips = [
      commute('2026-10-26', '23:50', 20),
      commute('2026-10-27', '00:05', 20),
      commute('2026-10-27', '23:55', 20),
    ];
    const [t] = movementStats(trips.map((x) => x.j), trips.flatMap((x) => x.v), OPTS).commonTrips;
    expect(t.usualDeparture).toBe('23:55');
  });

  it('needs three: two occurrences are not a trip', () => {
    const a = commute('2026-10-20', '07:10', 20);
    const b = commute('2026-10-21', '07:20', 30);
    expect(movementStats([a.j, b.j], [...a.v, ...b.v], OPTS).commonTrips).toEqual([]);
  });

  it('drops a journey with an unnamed end, and one whose visit is over 20 minutes away', () => {
    const trips = ['2026-10-20', '2026-10-21', '2026-10-22'].map((d) => commute(d, '07:10', 20));
    // Day 3's destination is unnamed.
    trips[2].v[1] = { ...trips[2].v[1], label: null };
    expect(movementStats(trips.map((t) => t.j), trips.flatMap((t) => t.v), OPTS).commonTrips).toEqual([]);

    // Day 3 named again, but the stay before it ended 25 minutes before leaving.
    const again = ['2026-10-20', '2026-10-21', '2026-10-22'].map((d) => commute(d, '07:10', 20));
    const j3 = again[2].j;
    again[2].v[0] = { ...again[2].v[0], to: new Date(j3.startedAt.getTime() - 25 * 60_000) };
    expect(movementStats(again.map((t) => t.j), again.flatMap((t) => t.v), OPTS).commonTrips).toEqual([]);
  });
});

describe('time out', () => {
  const HOME = 'p-home';

  it('counts the gap between two stays at home when a journey began in it', () => {
    const s = movementStats(
      [journey('2026-10-27T09:05:00Z', 15, 3, 'walking'), journey('2026-10-27T11:40:00Z', 15, 3, 'walking')],
      [
        visit(HOME, 'Home', '2026-10-26T20:00:00Z', '2026-10-27T09:00:00Z'),
        visit('p-shop', 'Shop', '2026-10-27T09:25:00Z', '2026-10-27T11:30:00Z'),
        visit(HOME, 'Home', '2026-10-27T12:00:00Z', '2026-10-28T08:00:00Z'),
      ],
      { ...OPTS, homePlaceId: HOME },
    );
    expect(s.timeOut).toHaveLength(30);
    const day = s.timeOut.find((d) => d.date === '2026-10-27');
    // GMT from the 25th: local time equals UTC.
    expect(day).toEqual({ date: '2026-10-27', minutesOut: 180, firstOut: '09:00', lastIn: '12:00' });
    expect(s.timeOut.find((d) => d.date === '2026-10-26')).toEqual({
      date: '2026-10-26',
      minutesOut: 0,
      firstOut: null,
      lastIn: null,
    });
  });

  it('does not count a quiet phone overnight as time out', () => {
    // Two stays at home with a hole between them and no journey in it.
    const s = movementStats(
      [],
      [
        visit(HOME, 'Home', '2026-10-26T18:00:00Z', '2026-10-27T01:00:00Z'),
        visit(HOME, 'Home', '2026-10-27T05:00:00Z', '2026-10-27T10:00:00Z'),
      ],
      { ...OPTS, homePlaceId: HOME },
    );
    expect(s.timeOut.every((d) => d.minutesOut === 0 && d.firstOut === null)).toBe(true);
  });

  it('runs an outing still under way to now, with no return yet', () => {
    const s = movementStats(
      [journey('2026-10-28T10:05:00Z', 15, 3, 'walking')],
      [visit(HOME, 'Home', '2026-10-27T20:00:00Z', '2026-10-28T10:00:00Z')],
      { ...OPTS, homePlaceId: HOME },
    );
    expect(s.timeOut.at(-1)).toEqual({ date: '2026-10-28', minutesOut: 120, firstOut: '10:00', lastIn: null });
  });

  it('splits an outing across midnight on the local clock (BST)', () => {
    // Out 22:00 BST on the 20th (21:00 UTC), back 01:00 BST on the 21st.
    const s = movementStats(
      [journey('2026-10-20T21:05:00Z', 15, 3, 'vehicle')],
      [
        visit(HOME, 'Home', '2026-10-20T08:00:00Z', '2026-10-20T21:00:00Z'),
        visit(HOME, 'Home', '2026-10-21T00:00:00Z', '2026-10-21T08:00:00Z'),
      ],
      { ...OPTS, homePlaceId: HOME },
    );
    expect(s.timeOut.find((d) => d.date === '2026-10-20')).toEqual({
      date: '2026-10-20',
      minutesOut: 120,
      firstOut: '22:00',
      lastIn: null,
    });
    expect(s.timeOut.find((d) => d.date === '2026-10-21')).toEqual({
      date: '2026-10-21',
      minutesOut: 60,
      firstOut: null,
      lastIn: '01:00',
    });
  });

  it('cuts days at true local midnight on both clock-change days', () => {
    // 25 Oct 2026 began at 23:00 UTC on the 24th (BST) and is 25 hours long.
    // Out from 23:00 UTC on the 24th (00:00 local, the 25th) to 01:00 UTC.
    const autumn = movementStats(
      [journey('2026-10-24T23:05:00Z', 15, 3, 'walking')],
      [
        visit(HOME, 'Home', '2026-10-24T18:00:00Z', '2026-10-24T23:00:00Z'),
        visit(HOME, 'Home', '2026-10-25T01:00:00Z', '2026-10-25T08:00:00Z'),
      ],
      { ...OPTS, homePlaceId: HOME },
    );
    expect(autumn.timeOut.find((d) => d.date === '2026-10-24')?.minutesOut).toBe(0);
    expect(autumn.timeOut.find((d) => d.date === '2026-10-25')).toEqual({
      date: '2026-10-25',
      minutesOut: 120,
      firstOut: '00:00',
      lastIn: '01:00',
    });

    // 29 Mar 2026 began at 00:00 UTC (GMT). Out 23:30–00:30 UTC across it.
    const spring = movementStats(
      [journey('2026-03-28T23:35:00Z', 15, 3, 'walking')],
      [
        visit(HOME, 'Home', '2026-03-28T18:00:00Z', '2026-03-28T23:30:00Z'),
        visit(HOME, 'Home', '2026-03-29T00:30:00Z', '2026-03-29T08:00:00Z'),
      ],
      { days: 5, now: new Date('2026-03-30T12:00:00Z'), homePlaceId: HOME },
    );
    expect(spring.timeOut.find((d) => d.date === '2026-03-28')).toEqual({
      date: '2026-03-28',
      minutesOut: 30,
      firstOut: '23:30',
      lastIn: null,
    });
    expect(spring.timeOut.find((d) => d.date === '2026-03-29')).toEqual({
      date: '2026-03-29',
      minutesOut: 30,
      firstOut: null,
      lastIn: '00:30',
    });
  });

  it('is empty without a home place', () => {
    expect(movementStats([], [], OPTS).timeOut).toEqual([]);
  });
});
