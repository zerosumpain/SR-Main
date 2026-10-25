import { describe, expect, it } from 'vitest';
import { checkpointsOf, datesBetween, liveFromTrips, scoreForecast } from './forecast-eval';
import type { InsightPlace, Trip } from './insights';

const MINUTE = 60_000;
const places: InsightPlace[] = [
  { id: 'home', label: 'Home', kind: 'home', lat: 54.7, lon: -1.6, radiusM: 80 },
  { id: 'school', label: 'School', kind: 'other', lat: 54.71, lon: -1.6, radiusM: 80 },
];
const people = [{ subject: 'alex', displayName: 'Alex' }];

/** A straight-line trip between two places, one fix a minute. */
function trip(from: string, to: string, start: string, minutes: number): Trip {
  const a = places.find((p) => p.id === from)!, b = places.find((p) => p.id === to)!;
  const t0 = Date.parse(start);
  const path = Array.from({ length: minutes + 1 }, (_, i) => ({
    subject: 'alex', ts: new Date(t0 + i * MINUTE), placeId: i === 0 ? from : null,
    lat: a.lat + ((b.lat - a.lat) * i) / minutes, lon: a.lon + ((b.lon - a.lon) * i) / minutes, accuracyM: 10, speedKmh: 20,
  }));
  return { subject: 'alex', from, to, start: t0, end: t0 + minutes * MINUTE, minutes, mode: 'vehicle', path };
}

// Weekdays, 1 Sep – 9 Oct 2026 (BST): 07:20Z is 08:20 local.
const weekdays = datesBetween('2026-09-01', '2026-10-09').filter((d) => ![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()));
const schoolRuns = weekdays.flatMap((d, i) => [
  trip('home', 'school', `${d}T07:20:00Z`, 15 + (i % 3)),
  trip('school', 'home', `${d}T14:30:00Z`, 16),
]);

describe('checkpoints', () => {
  it('are local half-hours from 06:00 to 21:30, on either side of a clock change', () => {
    expect(checkpointsOf('2026-10-21')).toHaveLength(32);
    expect(new Date(checkpointsOf('2026-10-21')[0]).toISOString()).toBe('2026-10-21T05:00:00.000Z');
    expect(new Date(checkpointsOf('2026-11-02')[0]).toISOString()).toBe('2026-11-02T06:00:00.000Z');
  });
});

describe('where everyone is, read off the trips', () => {
  it('is the end of the last trip, the trip they are on, or unknown', () => {
    const at = (iso: string) => liveFromTrips(schoolRuns, people, Date.parse(iso))[0];
    expect(at('2026-09-01T10:00:00Z')).toMatchObject({ placeId: 'school', moving: null });
    expect(at('2026-09-01T07:25:00Z')).toMatchObject({ placeId: null, moving: { fromId: 'home' } });
    expect(at('2026-08-31T10:00:00Z')).toMatchObject({ placeId: null, lastSeen: null });
  });
});

describe('the scorecard', () => {
  const card = scoreForecast({ trips: schoolRuns, places, people, homeIds: new Set(['home']), from: '2026-10-05', to: '2026-10-09' });

  it('sees a dependable school run coming, and is right about it', () => {
    expect(card.days).toBe(5);
    expect(card.next.predictions).toBeGreaterThanOrEqual(5);
    expect(card.next.precision).toBe(1);
    expect(card.next.recall).toBeGreaterThan(0.4);
  });

  it('learns journey times only from trips that had already happened', () => {
    expect(card.duration.trips).toBe(10);
    expect(card.duration.estimated).toBe(10);
    expect(card.duration.medianError).toBeLessThanOrEqual(1);
  });

  it('asks the live arrival part-way through each trip and finds the right place', () => {
    expect(card.eta.checks).toBe(30);
    expect(card.eta.wrongPlace).toBe(0);
    expect(card.eta.rightPlace).toBeGreaterThan(0);
  });

  it('counts a missed school run as an overdue that never went', () => {
    const skipped = schoolRuns.filter((t) => !t.path[0].ts.toISOString().startsWith('2026-10-07'));
    const c = scoreForecast({ trips: skipped, places, people, homeIds: new Set(['home']), from: '2026-10-07', to: '2026-10-07' });
    expect(c.overdue).toEqual({ fired: 1, late: 0, skipped: 1 });
  });

  it('has nothing to say with no history', () => {
    const c = scoreForecast({ trips: [], places, people, homeIds: new Set(['home']), from: '2026-10-05', to: '2026-10-05' });
    expect(c.next).toMatchObject({ predictions: 0, precision: null, recall: null });
    expect(c.duration.mae).toBeNull();
  });
});
