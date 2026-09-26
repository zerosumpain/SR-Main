import { describe, expect, it } from 'vitest';
import type { DayPoint } from './companion-accounts';
import {
  clockAt,
  dayBounds,
  dayChoices,
  dayWindowFor,
  duration,
  heartRateAt,
  heartRateRuns,
  kilometres,
  localDate,
  momentAt,
  segmentsFor,
  segmentsOf,
  sleepBands,
  stepsForDay,
  trackShapes,
  unionSeconds,
  unionSpans,
  workoutSpans,
} from './day-timeline';

// Made-up coordinates (51.0, -1.0): this repo is public.
const T0 = Date.parse('2026-09-20T08:00:00Z') / 1000;
const pt = (dt: number, lng = -1, lat = 51, moving = 1): DayPoint => [lng, lat, T0 + dt, 8, moving, 1.4];

describe('days are the browser’s days', () => {
  it('buckets by the offset getTimezoneOffset reports (BST = -60)', () => {
    const halfPastMidnightBst = Date.parse('2026-09-19T23:30:00Z') / 1000;
    expect(localDate(halfPastMidnightBst, 0)).toBe('2026-09-19');
    expect(localDate(halfPastMidnightBst, -60)).toBe('2026-09-20');
  });

  it('bounds a local date', () => {
    const [from, to] = dayBounds('2026-09-20', -60);
    expect(new Date(from * 1000).toISOString()).toBe('2026-09-19T23:00:00.000Z');
    expect(to - from).toBe(86_400);
  });

  it('clocks on the reader’s time', () => {
    expect(clockAt(Date.parse('2026-09-20T07:05:00Z') / 1000, -60)).toBe('08:05');
  });

  it('offers today and the thirty days before, newest first', () => {
    const now = Date.parse('2026-09-20T23:30:00Z') / 1000; // already the 21st in BST
    const c = dayChoices(now, -60);
    expect(c).toHaveLength(31);
    expect(c[0]).toEqual({ date: '2026-09-21', label: 'Today' });
    expect(c[1]).toEqual({ date: '2026-09-20', label: 'Yesterday' });
    expect(c[30].date).toBe('2026-08-22');
  });
});

describe('dayWindowFor — what the endpoint accepts', () => {
  const now = Date.parse('2026-09-20T12:00:00Z') / 1000;

  it('accepts today and thirty days back, with the window in the reader’s zone', () => {
    const r = dayWindowFor('2026-09-20', '-60', now);
    expect(r).toEqual({ ok: true, from: dayBounds('2026-09-20', -60)[0], to: dayBounds('2026-09-20', -60)[1], tz: -60, date: '2026-09-20' });
    expect(dayWindowFor('2026-08-21', '0', now).ok).toBe(true);
  });

  it('reads an absent tz as UTC, not as garbage', () => {
    expect(dayWindowFor('2026-09-20', null, now)).toMatchObject({ ok: true, tz: 0 });
  });

  it('refuses the future, beyond thirty days, bad dates and bad offsets', () => {
    expect(dayWindowFor('2026-09-21', '0', now).ok).toBe(false);
    expect(dayWindowFor('2026-08-20', '0', now).ok).toBe(false);
    expect(dayWindowFor('20-09-2026', '0', now).ok).toBe(false);
    expect(dayWindowFor(null, '0', now).ok).toBe(false);
    expect(dayWindowFor('2026-09-20', '1.5', now).ok).toBe(false);
    expect(dayWindowFor('2026-09-20', '900', now).ok).toBe(false);
  });
});

describe('segments and what the map draws', () => {
  const points = [pt(0), pt(30, -1.001), pt(60, -1.002), pt(60 + 601, -1.01), pt(60 + 631, -1.011), pt(5000, -1.02)];

  it('splits over a 600 s gap, not at it', () => {
    expect(segmentsOf(points)).toEqual([
      [0, 2],
      [3, 4],
      [5, 5],
    ]);
    expect(segmentsOf([pt(0), pt(600)])).toEqual([[0, 1]]);
    expect(segmentsOf([])).toEqual([]);
  });

  it('rebuilds segments only when the pilot sent none', () => {
    expect(segmentsFor({ points, segments: [[0, 5]], gapSeconds: 600 })).toEqual([[0, 5]]);
    expect(segmentsFor({ points, segments: [], gapSeconds: 600 })).toHaveLength(3);
  });

  it('draws solid runs, a dashed hop between each, and a lone fix as a point', () => {
    const s = trackShapes(points, segmentsOf(points));
    expect(s.lines).toHaveLength(2);
    expect(s.lines[0]).toEqual([
      [-1, 51],
      [-1.001, 51],
      [-1.002, 51],
    ]);
    expect(s.gaps).toEqual([
      [
        [-1.002, 51],
        [-1.01, 51],
      ],
      [
        [-1.011, 51],
        [-1.02, 51],
      ],
    ]);
    expect(s.lone).toEqual([[-1.02, 51]]);
    expect(s.start).toEqual([-1, 51]);
    expect(s.end).toEqual([-1.02, 51]);
  });

  it('draws nothing for an empty day', () => {
    expect(trackShapes([], [])).toEqual({ lines: [], gaps: [], lone: [], start: null, end: null });
  });
});

describe('the scrub cursor', () => {
  const points = [pt(0), pt(30), pt(2000)];

  it('lands on the nearest fix within the gap', () => {
    expect(momentAt(points, T0 + 20)).toEqual({ point: points[1], gap: 10 });
  });

  it('shows no position when the nearest fix is further than the gap — the phone slept', () => {
    expect(momentAt(points, T0 + 1000)).toEqual({ point: null, gap: 970 });
  });

  it('knows there was no location at all', () => {
    expect(momentAt([], T0)).toEqual({ point: null, gap: null });
  });
});

describe('sleep is a union, clipped to the day', () => {
  const from = Date.parse('2026-09-19T23:00:00Z') / 1000;
  const to = from + 86_400;

  it('merges overlapping spans and counts overlap once', () => {
    expect(unionSpans([[0, 10], [5, 20], [30, 40]], 0, 100)).toEqual([
      [0, 20],
      [30, 40],
    ]);
    expect(unionSeconds([[0, 10], [5, 20], [30, 40]], 0, 100)).toBe(30);
    expect(unionSeconds([[-50, 10]], 0, 100)).toBe(10);
  });

  it('keeps only asleep stages, across sources, and drops what fell the day before', () => {
    const bands = sleepBands(
      [
        { stage: 'asleep', start: '2026-09-19T22:00:00Z', end: '2026-09-20T05:00:00Z' }, // phone
        { stage: 'deep', start: '2026-09-20T01:00:00Z', end: '2026-09-20T02:00:00Z' }, // watch, inside it
        { stage: 'in_bed', start: '2026-09-20T05:00:00Z', end: '2026-09-20T06:00:00Z' },
        { stage: 'awake', start: '2026-09-20T03:00:00Z', end: '2026-09-20T03:10:00Z' },
      ],
      from,
      to,
    );
    expect(bands).toEqual([[from, Date.parse('2026-09-20T05:00:00Z') / 1000]]);
  });
});

describe('workouts, steps and heart rate', () => {
  const from = Date.parse('2026-09-19T23:00:00Z') / 1000;
  const to = from + 86_400;

  it('clips workouts to the day, in order', () => {
    const w = workoutSpans(
      [
        { activity: 'Run', start: '2026-09-20T18:00:00Z', end: '2026-09-20T18:30:00Z', seconds: 1800, distance: 5000 },
        { activity: 'Walk', start: '2026-09-19T22:30:00Z', end: '2026-09-19T23:30:00Z', seconds: 3600, distance: null },
        { activity: 'Swim', start: '2026-09-18T10:00:00Z', end: '2026-09-18T11:00:00Z', seconds: 3600, distance: null },
      ],
      from,
      to,
    );
    expect(w.map((x) => x.activity)).toEqual(['Walk', 'Run']);
    expect(w[0].from).toBe(from);
  });

  it('takes the step record that overlaps the day most — never a sum of two', () => {
    const steps = [
      { value: 4000, start: '2026-09-18T23:00:00Z', end: '2026-09-19T23:00:00Z' },
      { value: 9000, start: '2026-09-19T23:00:00Z', end: '2026-09-20T23:00:00Z' },
    ];
    expect(stepsForDay(steps, from, to)).toBe(9000);
    expect(stepsForDay([], from, to)).toBeNull();
  });

  it('reads heart rate only within one bin, and breaks the line over a hole', () => {
    const series = {
      seconds: 300,
      bins: [
        [T0, 70],
        [T0 + 300, 80],
        [T0 + 3000, 60],
      ] as Array<[number, number]>,
    };
    expect(heartRateAt(series, T0 + 150)).toBe(70);
    expect(heartRateAt(series, T0 + 1500)).toBeNull();
    const runs = heartRateRuns(series);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual([
      [T0 + 150, 70],
      [T0 + 450, 80],
    ]);
  });
});

describe('figures', () => {
  it('formats distance and time as the dashboard did', () => {
    expect(kilometres(850)).toBe('850 m');
    expect(kilometres(1500)).toBe('1.5 km');
    expect(kilometres(12_400)).toBe('12 km');
    expect(duration(45 * 60)).toBe('45m');
    expect(duration(125 * 60)).toBe('2h 05m');
  });
});
