import { describe, expect, it } from 'vitest';
import type { Journey } from './journeys';
import type { MovementMode } from './types';
import {
  circularMedianMinute,
  hhmm,
  localWeekStart,
  localWindow,
  modeBucket,
  movementStats,
  placeTime,
  placeTimeByPlace,
  type StatsVisit,
} from './stats';

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
      { fromLabel: 'Home', toLabel: 'Work', count: 3, usualDeparture: '08:20', medianSeconds: 1500, totalSeconds: 4500, mode: 'car' },
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

  it('pulls out-and-back loops into round trips, whatever their count, not the table', () => {
    const loop = (day: string, mins: number) => {
      const start = new Date(`${day}T07:00:00Z`);
      const end = new Date(start.getTime() + mins * 60_000);
      return {
        j: journey(start.toISOString(), mins, 2, 'walking'),
        v: [
          visit('p-home', 'Home', new Date(start.getTime() - 600 * 60_000).toISOString(), new Date(start.getTime() - 2 * 60_000).toISOString()),
          visit('p-home', 'Home', new Date(end.getTime() + 3 * 60_000).toISOString(), new Date(end.getTime() + 300 * 60_000).toISOString()),
        ],
      };
    };
    const loops = [loop('2026-10-20', 20), loop('2026-10-21', 40), loop('2026-10-22', 30)];
    const commutes = ['2026-10-23', '2026-10-24', '2026-10-25'].map((d) => commute(d, '07:10', 20));
    const all = [...loops, ...commutes];
    const s = movementStats(all.map((x) => x.j), all.flatMap((x) => x.v), OPTS);
    expect(s.commonTrips.map((t) => `${t.fromLabel}→${t.toLabel}`)).toEqual(['Home→Work']);
    expect(s.roundTrips).toEqual({ count: 3, medianSeconds: 1800, totalSeconds: 5400 });
    // One loop alone is still a round trip: the three-journey rule is for trips.
    const one = loop('2026-10-20', 20);
    expect(movementStats([one.j], one.v, OPTS).roundTrips).toEqual({ count: 1, medianSeconds: 1200, totalSeconds: 1200 });
    expect(movementStats([], [], OPTS).roundTrips).toBeNull();
  });
});

describe('time per place', () => {
  // A GMT week, so UTC clock times equal the house's.
  const W = { from: new Date('2026-11-02T00:00:00Z'), to: new Date('2026-11-09T00:00:00Z') };

  it('sums time per name, clipped to the window, with its share and visit count', () => {
    const t = placeTime(
      [
        visit('p-home', 'Home', '2026-11-01T18:00:00Z', '2026-11-02T08:00:00Z'), // 8h inside
        visit('p-work', 'Work', '2026-11-02T09:00:00Z', '2026-11-02T17:00:00Z'),
        visit('p-home', 'Home', '2026-11-02T18:00:00Z', '2026-11-03T08:00:00Z'),
        visit('p-shop', null, '2026-11-03T12:00:00Z', '2026-11-03T12:30:00Z'),
        visit('p-late', 'Late', '2026-11-08T23:00:00Z', '2026-11-09T02:00:00Z'), // 1h inside
        visit('p-old', 'Old', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z'), // outside
      ],
      W,
    );
    expect(t.windowMinutes).toBe(7 * 24 * 60);
    expect(t.places.map((p) => [p.label, p.minutes, p.visits])).toEqual([
      ['Home', 22 * 60, 2],
      ['Work', 8 * 60, 1],
      ['Late', 60, 1],
    ]);
    expect(t.places[0].share).toBeCloseTo((22 * 60) / (7 * 24 * 60), 6);
    expect(t.unnamed).toEqual({ minutes: 30, visits: 1 });
  });

  it('merges two places that carry one name, keeping both ids', () => {
    const t = placeTime(
      [visit('p-b', 'School', '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z'), visit('p-a', 'School', '2026-11-04T09:00:00Z', '2026-11-04T11:00:00Z')],
      W,
    );
    expect(t.places).toHaveLength(1);
    expect(t.places[0]).toMatchObject({ label: 'School', placeIds: ['p-a', 'p-b'], minutes: 180, visits: 2 });
  });

  it('takes usual arrival and departure on a clock, counting only those inside the window', () => {
    const t = placeTime(
      [
        visit('p-h', 'Home', '2026-11-01T23:50:00Z', '2026-11-02T07:00:00Z'), // arrived before the window
        visit('p-h', 'Home', '2026-11-03T00:10:00Z', '2026-11-03T08:00:00Z'),
        visit('p-h', 'Home', '2026-11-04T23:55:00Z', '2026-11-05T07:00:00Z'),
        visit('p-h', 'Home', '2026-11-06T00:05:00Z', '2026-11-06T09:00:00Z'),
      ],
      W,
    );
    // 00:10, 23:55, 00:05 → 00:05; not dragged toward noon, and 23:50 is not counted.
    expect(t.places[0].usualArrival).toBe('00:05');
    // 07:00, 08:00, 07:00, 09:00: the first stay's LEAVING is inside the window.
    expect(t.places[0].usualDeparture).toBe('07:30');
  });

  it('gives no departure for a stay still under way at the end of the window', () => {
    const t = placeTime([visit('p-w', 'Work', '2026-11-08T20:00:00Z', '2026-11-08T23:50:00Z')], W);
    expect(t.places[0].usualArrival).toBe('20:00');
    expect(t.places[0].usualDeparture).toBeNull();
  });

  it('counts time in transit from the journeys, clipped to the window', () => {
    const t = placeTime(
      [],
      W,
      [journey('2026-11-03T08:00:00Z', 30, 8, 'vehicle'), journey('2026-11-01T23:40:00Z', 40, 20, 'vehicle')],
    );
    expect(t.transitMinutes).toBe(30 + 20);
  });

  it('opens the window at true local midnight across the clock change', () => {
    // Autumn: Sunday 25 Oct 2026 is 25 hours long.
    const w = localWindow(new Date('2026-10-26T12:00:00Z'), 2);
    expect(w.from.toISOString()).toBe('2026-10-24T23:00:00.000Z'); // 00:00 BST
    const t = placeTime([visit('p-h', 'Home', '2026-10-24T22:00:00Z', '2026-10-26T12:00:00Z')], w);
    expect(t.windowMinutes).toBe((25 + 12) * 60);
    expect(t.places[0].minutes).toBe((25 + 12) * 60);
    expect(t.places[0].share).toBeCloseTo(1, 6);
    // Spring: Sunday 29 Mar 2026 is 23 hours long, and starts at 00:00 GMT.
    const spring = localWindow(new Date('2026-03-30T12:00:00Z'), 2);
    expect(spring.from.toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(placeTime([], spring).windowMinutes).toBe((23 + 13) * 60);
  });

  it('is part of movementStats over the same local days as time out', () => {
    const s = movementStats([], [visit('p-h', 'Home', '2026-10-27T00:00:00Z', '2026-10-28T12:00:00Z')], OPTS);
    expect(s.placeTime.places[0]).toMatchObject({ label: 'Home', minutes: 36 * 60 });
    expect(s.placeTime.windowMinutes).toBe(Math.round((NOW.getTime() - localWindow(NOW, 30).from.getTime()) / 60_000));
  });
});

describe('time per place, by person', () => {
  const W = { from: new Date('2026-11-02T00:00:00Z'), to: new Date('2026-11-09T00:00:00Z') };
  it('lists each place’s people, most time first, under every id the name covers', () => {
    const alex = placeTime([visit('p-a', 'School', '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z')], W);
    const sam = placeTime(
      [
        visit('p-b', 'School', '2026-11-03T09:00:00Z', '2026-11-03T15:00:00Z'),
        visit('p-a', 'School', '2026-11-04T09:00:00Z', '2026-11-04T10:00:00Z'),
        visit('p-h', 'Home', '2026-11-03T16:00:00Z', '2026-11-03T20:00:00Z'),
      ],
      W,
    );
    const nobody = placeTime([], W);
    const out = placeTimeByPlace([
      { subject: 'alex', displayName: 'Alex', time: alex },
      { subject: 'sam', displayName: 'Sam', time: sam },
      { subject: 'kit', displayName: 'Kit', time: nobody },
    ]);
    expect(out['p-a'].map((r) => r.displayName)).toEqual(['Sam', 'Alex']);
    // Sam's one "School" row (both ids) is under each; Alex was only at p-a.
    expect(out['p-b'].map((r) => [r.displayName, r.minutes])).toEqual([['Sam', 420]]);
    expect(out['p-h']).toEqual([{ subject: 'sam', displayName: 'Sam', minutes: 240, share: 240 / (7 * 1440), visits: 1, usualArrival: '16:00' }]);
    expect(Object.values(out).flat().some((r) => r.subject === 'kit')).toBe(false);
  });
});

describe('time out', () => {
  const HOME = 'p-home';

  it('counts the gap between two stays at home when a journey began in it', () => {
    const s = movementStats(
      [journey('2026-10-27T09:00:00Z', 15, 3, 'walking'), journey('2026-10-27T11:40:00Z', 15, 3, 'walking')],
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
      [journey('2026-10-28T10:00:00Z', 15, 3, 'walking')],
      [visit(HOME, 'Home', '2026-10-27T20:00:00Z', '2026-10-28T10:00:00Z')],
      { ...OPTS, homePlaceId: HOME },
    );
    expect(s.timeOut.at(-1)).toEqual({ date: '2026-10-28', minutesOut: 120, firstOut: '10:00', lastIn: null });
  });

  it('splits an outing across midnight on the local clock (BST)', () => {
    // Out 22:00 BST on the 20th (21:00 UTC), back 01:00 BST on the 21st.
    const s = movementStats(
      [journey('2026-10-20T21:00:00Z', 15, 3, 'vehicle')],
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
      [journey('2026-10-24T23:00:00Z', 15, 3, 'walking')],
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
      [journey('2026-03-28T23:30:00Z', 15, 3, 'walking')],
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

  it('starts an outing at the departure, not the last home fix before a silent night', () => {
    // Home until 22:00 on the 26th, then the phone says nothing all night. A
    // brief stay at home 07:30–07:36 is too short to be a visit, so there is
    // no home stay to leave from; the walk out starts at 07:38. GMT: local = UTC.
    const s = movementStats(
      [journey('2026-10-27T07:38:00Z', 20, 2, 'walking')],
      [
        visit(HOME, 'Home', '2026-10-26T18:00:00Z', '2026-10-26T22:00:00Z'),
        visit('p-shop', 'Shop', '2026-10-27T08:00:00Z', '2026-10-27T08:40:00Z'),
        visit(HOME, 'Home', '2026-10-27T09:00:00Z', '2026-10-27T20:00:00Z'),
      ],
      { ...OPTS, homePlaceId: HOME },
    );
    expect(s.timeOut.find((d) => d.date === '2026-10-26')).toEqual({
      date: '2026-10-26',
      minutesOut: 0,
      firstOut: null,
      lastIn: null,
    });
    expect(s.timeOut.find((d) => d.date === '2026-10-27')).toEqual({
      date: '2026-10-27',
      minutesOut: 82,
      firstOut: '07:38',
      lastIn: '09:00',
    });
  });

  it('counts an outing already under way when the window opens, from its first journey', () => {
    // Window: 3 days back from NOW (the 25th, 12:00). Out before any stay at
    // home in the window; the first journey is on the 26th at 10:00.
    const s = movementStats(
      [journey('2026-10-26T10:00:00Z', 60, 40, 'vehicle'), journey('2026-10-24T09:00:00Z', 60, 40, 'vehicle')],
      [visit(HOME, 'Home', '2026-10-26T13:00:00Z', '2026-10-28T12:00:00Z')],
      { days: 3, now: NOW, homePlaceId: HOME },
    );
    expect(s.timeOut.find((d) => d.date === '2026-10-26')).toEqual({
      date: '2026-10-26',
      minutesOut: 180,
      firstOut: '10:00',
      lastIn: '13:00',
    });
    expect(s.timeOut.reduce((n, d) => n + d.minutesOut, 0)).toBe(180);
  });

  it('counts a window with journeys but no stay at home as out from the first journey', () => {
    const s = movementStats([journey('2026-10-28T09:00:00Z', 30, 5, 'vehicle')], [], {
      days: 2,
      now: NOW,
      homePlaceId: HOME,
    });
    expect(s.timeOut.at(-1)).toEqual({ date: '2026-10-28', minutesOut: 180, firstOut: '09:00', lastIn: null });
  });

  it('is empty without a home place', () => {
    expect(movementStats([], [], OPTS).timeOut).toEqual([]);
  });
});
