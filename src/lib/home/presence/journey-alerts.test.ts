import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));

const { drivingLine, journeyNotice, recentTrips, tripStats } = await import('./journey-alerts');
import type { RouteInsight } from './insights';

const NOW = new Date('2026-11-01T09:00:00Z');
const route = (over: Partial<RouteInsight> = {}): RouteInsight => ({
  id: 'r', subject: 'rory', person: 'Rory', fromId: 'home', toId: 'school', from: 'Home', to: 'School',
  samples: 1, average: 18, median: 18, low: 18, high: 18, departure: '08:20', morning: 1, mode: 'vehicle', broken: 0,
  trips: [{ start: '2026-11-01T08:30:00.000Z', minutes: 18, broken: false }], ...over,
});
const places = [
  { id: 'home', label: 'Home', kind: 'home', lat: 54.5, lon: -1.55, radiusM: 50 },
  { id: 'school', label: 'Carmel College', kind: 'school', lat: 54.55, lon: -1.55, radiusM: 120 },
  { id: 'station', label: 'Darlington Train Station', kind: 'unknown', lat: 54.52, lon: -1.54, radiusM: 120 },
];
// One fix every 5 s north at `kmh`.
const fixes = (kmh: number, n = 60, mode = 'vehicle') =>
  Array.from({ length: n }, (_, i) => ({ ts: i * 5000, lat: 54.5 + (i * (kmh / 3.6) * 5) / 111_320, lon: -1.55, accuracyM: 8, speedKmh: kmh, mode }));

describe('tripStats', () => {
  it('reads a drive: distance, a 95th-percentile top speed, mode', () => {
    const s = tripStats([...fixes(48), { ts: 400_000, lat: 54.6, lon: -1.55, accuracyM: 8, speedKmh: 390, mode: 'vehicle' }].slice(0, 61));
    expect(s.mode).toBe('drive');
    expect(s.km).toBeGreaterThan(3.5);
    expect(s.topKmh).toBe(48);
  });

  it('a walk is not a journey', () => {
    expect(tripStats(fixes(5, 60, 'walking')).mode).toBeNull();
  });

  it('a long trip from a station is a train, whatever its speed', () => {
    expect(tripStats(fixes(90, 240), { from: places[2] }).mode).toBe('train');
    expect(tripStats(fixes(90, 240)).mode).toBe('drive');
  });
});

describe('journeyNotice', () => {
  const trip = recentTrips([route()], NOW)[0];

  it('is the trip that ended inside the stop window, and only that', () => {
    expect(trip.arrived).toBe(Date.parse('2026-11-01T08:48:00Z'));
    expect(recentTrips([route()], new Date('2026-11-01T10:00:00Z'))).toEqual([]);
  });

  it('says where, how long, how far, how fast, and how it was driven', () => {
    const n = journeyNotice({
      trip, stats: { mode: 'drive', km: 9.4, topKmh: 84 }, places, name: 'Rory', recipients: ['Katie@Example.test'],
      events: [{ at: '2026-11-01T08:40:00Z', kind: 'brake', fromKmh: 50, toKmh: 10, ms2: 4.1, lat: 0, lon: 0 }],
    })!;
    expect(n.push.title).toBe('Rory arrived safely at Carmel College');
    expect(n.push.body).toBe('18 min drive from Home, 5.8 mi, arrived 08:48. Top speed 52 mph. 1 harsh brake.');
    expect(n.recipients).toEqual(['katie@example.test']);
    expect(n.trip).toBe(`rory-${trip.arrived}`);
  });

  it('a train says so and carries no driving line; nothing for a non-journey or nobody to tell', () => {
    const n = journeyNotice({ trip, stats: { mode: 'train', km: 72, topKmh: 160 }, places, name: 'Rory', recipients: ['k@e.t'], events: [] })!;
    expect(n.push.body).toBe('18 min by train from Home, 45 mi, arrived 08:48. Top speed 99 mph.');
    expect(journeyNotice({ trip, stats: { mode: null, km: 1, topKmh: 5 }, places, name: 'Rory', recipients: ['k@e.t'], events: [] })).toBeNull();
    expect(journeyNotice({ trip, stats: { mode: 'drive', km: 1, topKmh: 5 }, places, name: 'Rory', recipients: [], events: [] })).toBeNull();
  });
});

describe('drivingLine', () => {
  it('counts each kind', () => {
    expect(drivingLine([])).toBe('No harsh braking or acceleration');
    const e = (kind: 'brake' | 'accel') => ({ at: '', kind, fromKmh: 0, toKmh: 0, ms2: 4, lat: 0, lon: 0 });
    expect(drivingLine([e('brake'), e('brake'), e('accel')])).toBe('2 harsh brakes, 1 hard acceleration');
  });
});
