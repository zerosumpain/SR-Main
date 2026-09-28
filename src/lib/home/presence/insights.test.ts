import { describe, expect, it } from 'vitest';
import { analysePresence, extractTrips, inDaylight, predictArrival, qualifiedStop, type InsightFix, type InsightPlace } from './insights';
const places: InsightPlace[] = [
  { id: 'home', label: 'Home', kind: 'home', lat: 51.5, lon: -.12, radiusM: 100 },
  { id: 'school', label: 'Sample College', kind: 'school', lat: 51.59, lon: -.12, radiusM: 100 },
];
const person = { subject: 'alex', displayName: 'Alex' };
function fix(t: string | number, lat = 51.5, extra: Partial<InsightFix> = {}): InsightFix {
  return { subject: 'alex', ts: new Date(t), lat, lon: -.12, accuracyM: 10, readingAgeS: 0, isHome: lat === 51.5, speedKmh: 0, mode: 'still', ...extra };
}
function journey(day: string, reverse = false): InsightFix[] {
  const depart = +new Date(`${day}T07:20:00Z`), points: InsightFix[] = [];
  const a = reverse ? 51.59 : 51.5, sign = reverse ? -1 : 1;
  for (let m = -12; m <= 0; m += 2) points.push(fix(depart + m * 60000, a));
  for (let m = 2; m <= 18; m += 2) points.push(fix(depart + m * 60000, a + sign * m / 2 * .01, { speedKmh: 33, mode: 'vehicle', isHome: false }));
  for (let m = 20; m <= 30; m += 2) points.push(fix(depart + m * 60000, a + sign * .09));
  return points;
}
const history = () => ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'].flatMap(day => journey(day));
describe('observed stops', () => {
  it('requires ten continuously observed minutes, and accepts duplicate reports', () => {
    const now = new Date('2026-09-28T12:00Z');
    const points = Array.from({ length: 6 }, (_, i) => fix(+now - (5 - i) * 120000));
    expect(qualifiedStop(points.slice(1), now)).toBeNull();
    expect(qualifiedStop([...points, points[2]], now)).toHaveLength(6);
  });
  it('refuses gaps, stale provider readings, poor accuracy and creeping traffic', () => {
    const now = new Date('2026-09-28T12:00Z');
    const points = Array.from({ length: 6 }, (_, i) => fix(+now - (5 - i) * 120000));
    expect(qualifiedStop(points.map(p => ({ ...p, readingAgeS: 900 })), now)).toBeNull();
    expect(qualifiedStop(points.map(p => ({ ...p, accuracyM: 500 })), now)).toBeNull();
    expect(qualifiedStop([points[0], points[5]], now)).toBeNull();
    expect(qualifiedStop(points.map((p, i) => ({ ...p, lat: 51.5 + i * .0005 })), now)).toBeNull();
    expect(qualifiedStop(points, new Date(+now + 4 * 60000))).toBeNull();
  });
});
describe('completed routes and arrival estimates', () => {
  const now = new Date('2026-09-28T07:28Z');
  it('learns directional routes and 8–9am weekday departures', () => {
    const data = analysePresence([...history(), ...journey('2026-09-25', true)], places, [person], now, 28);
    expect(data.routes).toHaveLength(2);
    expect(data.routes[0]).toMatchObject({ from: 'Home', to: 'Sample College', samples: 4, average: 18, morning: 4 });
    expect(data.routes[1]).toMatchObject({ from: 'Sample College', to: 'Home', samples: 1 });
  });
  it('estimates a matching live school route and a return home', () => {
    const live = journey('2026-09-28').filter(f => +f.ts <= +now);
    const { trips, active } = extractTrips([...history(), ...live], places, now);
    const eta = predictArrival(active, trips, places, person, now);
    expect(eta).toMatchObject({ to: 'Sample College', minutesLeft: 10, samples: 4, returningHome: false });
    expect(+new Date(eta!.earliest)).toBeLessThan(+new Date(eta!.eta));
    expect(+new Date(eta!.latest)).toBeGreaterThan(+new Date(eta!.eta));
    const back = extractTrips(['2026-09-21', '2026-09-22', '2026-09-23'].flatMap(d => journey(d, true)).concat(journey('2026-09-28', true).filter(f => +f.ts <= +now)), places, now);
    expect(predictArrival(back.active, back.trips, places, person, now)?.returningHome).toBe(true);
  });
  it('suppresses insufficient, stale, wrong-person, off-route, weekend and ambiguous predictions', () => {
    const data = extractTrips([...history(), ...journey('2026-09-28').filter(f => +f.ts <= +now)], places, now);
    expect(predictArrival(data.active, data.trips.slice(0, 2), places, person, now)).toBeNull();
    expect(predictArrival(data.active, data.trips, places, person, new Date(+now + 4 * 60000))).toBeNull();
    expect(predictArrival(data.active, data.trips, places, { ...person, subject: 'sam' }, now)).toBeNull();
    expect(predictArrival(data.active.map(p => ({ ...p, lon: -.4 })), data.trips, places, person, now)).toBeNull();
    const saturday = new Date('2026-09-26T07:28Z');
    const weekend = extractTrips(journey('2026-09-26').filter(f => +f.ts <= +saturday), places, saturday);
    expect(predictArrival(weekend.active, data.trips, places, person, saturday)).toBeNull();
    expect(predictArrival(data.active, [...data.trips, ...data.trips.map(t => ({ ...t, to: 'another' }))], [...places, { ...places[1], id: 'another' }], person, now)).toBeNull();
  });
  it('does not turn an observation gap or an unfinished journey into a route', () => {
    const points = journey('2026-09-21');
    const gap = points.filter((_, i) => i < 7 || i > 11);
    expect(extractTrips(gap, places, now).trips).toHaveLength(0);
    expect(extractTrips(points.slice(0, -6), places, now).trips).toHaveLength(0);
    expect(extractTrips(points.map((p, i) => i === 10 ? { ...p, lat: null } : p), places, now).trips).toHaveLength(0);
  });
});
describe('time, proximity and daylight', () => {
  const now = new Date('2026-09-28T12:00Z');
  it('counts overlapping group time once, including a group of three', () => {
    const people = [person, { subject: 'sam', displayName: 'Sam' }, { subject: 'jo', displayName: 'Jo' }];
    const points = people.flatMap(p => Array.from({ length: 6 }, (_, i) => fix(+now - (5 - i) * 120000, 51.5, { subject: p.subject })));
    const d = analysePresence(points, places, people, now, 7);
    expect(d.together).toBe(10); expect(d.groups).toHaveLength(1); expect(d.groups[0].subjects).toHaveLength(3);
    expect(d.people[0]).toMatchObject({ observed: 10, home: 10, wander: 0, daylight: 0, longestStill: 10 });
  });
  it('refuses nonoverlapping time, bad fixes and stale repeated readings', () => {
    const people = [person, { subject: 'sam', displayName: 'Sam' }];
    const points = [fix(+now - 600000), fix(+now - 480000), fix(+now - 240000, 51.5, { subject: 'sam' }), fix(+now - 120000, 51.5, { subject: 'sam' })];
    expect(analysePresence(points, places, people, now, 7).together).toBe(0);
    expect(analysePresence(points.map(p => ({ ...p, readingAgeS: 3600 })), places, people, now, 7).people[0].observed).toBe(0);
  });
  it('counts daylight walking but excludes vehicles, stationary time and night', () => {
    const p = [fix(+now - 120000, 51.51, { mode: 'walking', speedKmh: 5, isHome: false }), fix(+now, 51.5115, { mode: 'walking', speedKmh: 5, isHome: false })];
    expect(analysePresence(p, places, [person], now, 7).people[0]).toMatchObject({ wander: 2, daylight: 2 });
    expect(analysePresence(p.map(p => ({ ...p, mode: 'vehicle', speedKmh: 50 })), places, [person], now, 7).people[0].daylight).toBe(0);
    expect(inDaylight(+now, 51.5, -.12)).toBe(true);
    expect(inDaylight(+new Date('2026-09-28T00:00Z'), 51.5, -.12)).toBe(false);
    expect(inDaylight(+new Date('2026-12-21T12:00Z'), 80, 0)).toBe(false);
    expect(inDaylight(+new Date('2026-06-21T00:00Z'), 80, 0)).toBe(true);
  });
});

it('counts frequent phone walking fixes without mistaking short steps for stillness', () => {
  const now = new Date('2026-09-28T12:00Z');
  const points = Array.from({ length: 121 }, (_, i) => fix(+now - (120 - i) * 5000, 51.51 + i * .000063, { mode: 'walking', speedKmh: 5, isHome: false }));
  expect(analysePresence(points, places, [person], now, 7).people[0]).toMatchObject({ observed: 10, wander: 10, daylight: 10, stationary: 0 });
});
