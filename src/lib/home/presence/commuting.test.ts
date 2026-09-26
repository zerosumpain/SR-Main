import { describe, expect, it } from 'vitest';
import { COMMUTE_MAX, commutingJourneys, endLabel, routeLine, thin, type CommuteOpts } from './commuting';
import type { Journey, JourneyFix } from './journeys';
import type { StatsVisit } from './stats';

// Made-up coordinates throughout (51.0, -1.0): this repo is public.
const LAT = 51.0;
const LON = -1.0;
const NOW = new Date('2026-09-26T12:00:00Z');
const HOUR = 3_600_000;

function journey(over: Partial<Journey> & { startedAt: Date }): Journey {
  return {
    subject: 'alex',
    endedAt: new Date(over.startedAt.getTime() + 30 * 60_000),
    minutes: 30,
    distanceKm: 20,
    meanSpeedKmh: 40,
    maxSpeedKmh: 90,
    dominantMode: 'vehicle',
    fixCount: 10,
    fromPlaceId: null,
    toPlaceId: null,
    ...over,
  };
}

function fixes(j: Journey, n: number): JourneyFix[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(j.startedAt.getTime() + i * 60_000),
    lat: LAT + i * 0.001,
    lon: LON - i * 0.0001234567,
    subject: j.subject,
  }));
}

function opts(over: Partial<CommuteOpts> = {}): CommuteOpts {
  return {
    now: NOW,
    days: 30,
    labelOf: new Map(),
    visits: [],
    fixesOf: (j) => fixes(j, 5),
    ...over,
  };
}

describe('thin', () => {
  it('keeps short lists whole and long ones to max, first and last always kept', () => {
    expect(thin([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const long = Array.from({ length: 1000 }, (_, i) => i);
    const out = thin(long, 120);
    expect(out).toHaveLength(120);
    expect(out[0]).toBe(0);
    expect(out[119]).toBe(999);
    expect([...out].sort((a, b) => a - b)).toEqual(out);
    expect(thin(long, 1)).toEqual([0]);
    expect(thin(long, 0)).toEqual([]);
  });
});

describe('routeLine', () => {
  it('is [lon, lat] pairs rounded to five places, thinned, skipping broken fixes', () => {
    const j = journey({ startedAt: new Date(NOW.getTime() - HOUR) });
    const fs = fixes(j, 500);
    fs[3] = { ...fs[3], lat: Number.NaN };
    const line = routeLine(fs, 200);
    expect(line).toHaveLength(200);
    expect(line[0]).toEqual([-1, 51]);
    const last = fs[499];
    expect(line[199]).toEqual([Math.round(last.lon * 1e5) / 1e5, Math.round(last.lat * 1e5) / 1e5]);
    for (const [lon, lat] of line) {
      expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true);
      expect(String(lon).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(5);
    }
  });
});

describe('endLabel', () => {
  const labelOf = new Map<string, string | null>([
    ['p-home', 'Home'],
    ['p-work', 'Office'],
    ['p-anon', null],
  ]);
  const start = new Date('2026-09-20T08:00:00Z');

  it("names the place the journey's own end fix sits in", () => {
    const j = journey({ startedAt: start, fromPlaceId: 'p-home', toPlaceId: 'p-work' });
    expect(endLabel(j, 'from', labelOf, [])).toBe('Home');
    expect(endLabel(j, 'to', labelOf, [])).toBe('Office');
  });

  it('falls back to the stay it left from or reached within 20 minutes', () => {
    const j = journey({ startedAt: start, fromPlaceId: 'p-anon' });
    const visits: StatsVisit[] = [
      { placeId: 'p-home', label: 'Home', from: new Date(start.getTime() - 2 * HOUR), to: new Date(start.getTime() - 10 * 60_000) },
      { placeId: 'p-work', label: 'Office', from: new Date(j.endedAt.getTime() + 5 * 60_000), to: new Date(j.endedAt.getTime() + 3 * HOUR) },
    ];
    expect(endLabel(j, 'from', labelOf, visits)).toBe('Home');
    expect(endLabel(j, 'to', labelOf, visits)).toBe('Office');
  });

  it('is null for an unnamed end, and for a stay too long before', () => {
    const j = journey({ startedAt: start, fromPlaceId: 'p-anon', toPlaceId: null });
    const stale: StatsVisit[] = [
      { placeId: 'p-home', label: 'Home', from: new Date(start.getTime() - 5 * HOUR), to: new Date(start.getTime() - 2 * HOUR) },
    ];
    expect(endLabel(j, 'from', labelOf, stale)).toBeNull();
    expect(endLabel(j, 'to', labelOf, stale)).toBeNull();
  });
});

describe('commutingJourneys', () => {
  it('keeps car and rail journeys in the window, newest first, and drops the rest', () => {
    const car = journey({ startedAt: new Date(NOW.getTime() - 3 * HOUR) });
    const train = journey({ startedAt: new Date(NOW.getTime() - 2 * HOUR) });
    const storedRail = journey({ startedAt: new Date(NOW.getTime() - 26 * HOUR), dominantMode: 'rail' });
    const walk = journey({ startedAt: new Date(NOW.getTime() - HOUR), dominantMode: 'walking' });
    const cycle = journey({ startedAt: new Date(NOW.getTime() - HOUR / 2), dominantMode: 'active' });
    const old = journey({ startedAt: new Date(NOW.getTime() - 31 * 24 * HOUR) });
    const future = journey({ startedAt: new Date(NOW.getTime() + HOUR) });

    const out = commutingJourneys([old, car, storedRail, walk, train, cycle, future], opts({ isRail: (j) => j === train }));
    expect(out.map((c) => [c.startedAt, c.mode])).toEqual([
      [train.startedAt.toISOString(), 'rail'],
      [car.startedAt.toISOString(), 'car'],
      [storedRail.startedAt.toISOString(), 'rail'],
    ]);
  });

  it('carries the figures, the place names and a route per journey', () => {
    const j = journey({
      startedAt: new Date('2026-09-25T07:40:00Z'),
      distanceKm: 14.2,
      minutes: 25,
      meanSpeedKmh: 34.1,
      fromPlaceId: 'p-home',
    });
    const [c] = commutingJourneys([j], opts({ labelOf: new Map([['p-home', 'Home']]) }));
    expect(c).toMatchObject({
      id: String(j.startedAt.getTime()),
      endedAt: j.endedAt.toISOString(),
      mode: 'car',
      distanceKm: 14.2,
      minutes: 25,
      meanSpeedKmh: 34.1,
      fromLabel: 'Home',
      toLabel: null,
    });
    expect(c.route).toHaveLength(5);
  });

  it('caps the list at COMMUTE_MAX and each route at maxPoints — the payload stays small', () => {
    const many = Array.from({ length: 50 }, (_, i) => journey({ startedAt: new Date(NOW.getTime() - (i + 1) * 6 * HOUR) }));
    const out = commutingJourneys(many, opts({ fixesOf: (j) => fixes(j, 2000) }));
    expect(out).toHaveLength(COMMUTE_MAX);
    expect(out[0].startedAt).toBe(many[0].startedAt.toISOString());
    expect(Math.max(...out.map((c) => c.route.length))).toBeLessThanOrEqual(120);
    expect(JSON.stringify(out).length).toBeLessThan(100_000);
  });
});
