import { describe, expect, it } from 'vitest';
import { analysePatterns, categoryOf, groupOf, parsePlaceTypes, placeQuery, type PatternPlace } from './patterns';
import type { InsightFix } from './insights';

const places: PatternPlace[] = [
  { id: 'home', label: 'Home', kind: 'home', lat: 51.5, lon: -0.12, radiusM: 100 },
  { id: 'school', label: 'Sample College', kind: 'school', lat: 51.59, lon: -0.12, radiusM: 100 },
  { id: 'park', label: 'Stanhope Park', kind: 'other', lat: 51.52, lon: -0.12, radiusM: 150 },
];
const MIN = 60_000;

function fix(subject: string, t: number, lat: number, extra: Partial<InsightFix> = {}): InsightFix {
  return { subject, ts: new Date(t), lat, lon: -0.12, accuracyM: 10, readingAgeS: 0, isHome: lat === 51.5, speedKmh: 0, mode: 'still', ...extra };
}
/** Still at `lat` from `from` to `to`, a fix every two minutes. */
function stay(subject: string, from: number, to: number, lat: number): InsightFix[] {
  const out: InsightFix[] = [];
  for (let t = from; t <= to; t += 2 * MIN) out.push(fix(subject, t, lat));
  return out;
}
/** A drive from `a` to `b` latitude over 18 minutes. */
function drive(subject: string, at: number, a: number, b: number): InsightFix[] {
  const out: InsightFix[] = [];
  for (let m = 2; m <= 16; m += 2) out.push(fix(subject, at + m * MIN, a + ((b - a) * m) / 18, { speedKmh: 33, mode: 'vehicle', isHome: false }));
  return out;
}
/** A school day in UTC (London is UTC+1 in late September). */
function schoolDay(subject: string, day: string): InsightFix[] {
  const d0 = Date.parse(`${day}T00:00:00Z`);
  const leave = d0 + 7 * 60 * MIN, back = d0 + 15 * 60 * MIN;
  return [
    ...stay(subject, d0, leave, 51.5),
    ...drive(subject, leave, 51.5, 51.59),
    ...stay(subject, leave + 18 * MIN, back, 51.59),
    ...drive(subject, back, 51.59, 51.5),
    ...stay(subject, back + 18 * MIN, d0 + 24 * 60 * MIN - 2 * MIN, 51.5),
  ];
}
const DAYS = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];
const people = [{ subject: 'alex', displayName: 'Alex' }, { subject: 'sam', displayName: 'Sam' }];

describe('categoryOf', () => {
  const home = { lat: 51.5, lon: -0.12 };
  it('takes the owner kind, then the name, then the geocoder, then distance', () => {
    expect(categoryOf(places[0], 'home', home)).toBe('home');
    expect(categoryOf({ ...places[0], id: 'gran', label: 'Grandparents' }, 'home', home)).toBe('family');
    expect(categoryOf(places[1], 'home', home)).toBe('school');
    expect(categoryOf(places[2], 'home', home)).toBe('outdoors');
    expect(categoryOf({ id: 'a', label: 'Aldi', kind: 'other', lat: 51.5, lon: -0.1, radiusM: 80 }, 'home', home)).toBe('shops');
    expect(categoryOf({ id: 'b', label: null, kind: 'unknown', lat: 51.5, lon: -0.1, radiusM: 80, suggestedKind: 'cafe' }, 'home', home)).toBe('food');
    expect(categoryOf({ id: 'c', label: null, kind: 'unknown', lat: 41.9, lon: 12.47, radiusM: 80 }, 'home', home)).toBe('far');
    expect(categoryOf({ id: 'd', label: null, kind: 'unknown', lat: 51.51, lon: -0.1, radiusM: 80 }, 'home', home)).toBe('unnamed');
  });
  it('takes what a web lookup found over the words in a name, except for a nameless stop far away', () => {
    const shop = { category: 'shops' as const, type: 'Discount supermarket', name: null };
    expect(categoryOf({ id: 'l', label: 'LIDL / Homebargains', kind: 'unknown', lat: 51.5, lon: -0.1, radiusM: 80, lookup: shop }, 'home', home)).toBe('shops');
    expect(categoryOf({ id: 'h', label: 'Headlam Hall', kind: 'other', lat: 51.5, lon: -0.1, radiusM: 80, lookup: { category: 'stay', type: 'Hotel', name: null } }, 'home', home)).toBe('stay');
    expect(categoryOf({ id: 'g', label: 'Grandparents', kind: 'home', lat: 51.5, lon: -0.1, radiusM: 80, lookup: shop }, 'home', home)).toBe('family');
    expect(categoryOf({ id: 'r', label: null, kind: 'unknown', lat: 41.9, lon: 12.47, radiusM: 80, lookup: shop }, 'home', home)).toBe('far');
    expect(categoryOf({ id: 'o', label: 'Diamond Terrace', kind: 'other', lat: 51.5, lon: -0.1, radiusM: 80, lookup: { category: 'other', type: 'Street', name: null } }, 'home', home)).toBe('other');
    // Without a lookup the name still says something.
    expect(categoryOf({ id: 'm', label: 'Darlington Memorial Hospital', kind: 'other', lat: 51.5, lon: -0.1, radiusM: 80 }, 'home', home)).toBe('health');
    expect(categoryOf({ id: 'f', label: 'Flamingo Land', kind: 'other', lat: 51.5, lon: -0.1, radiusM: 80 }, 'home', home)).toBe('daysout');
  });
  it('searches a name with its town, an address as it is, and never a family house', () => {
    const base = { kind: 'unknown', lat: 51.5, lon: -0.1, radiusM: 80 };
    expect(placeQuery({ ...base, id: 'a', label: 'LIDL / Homebargains', suggestedAddress: '12 Cockerton Green, Darlington, DL3 9AA, United Kingdom' }, 'home')).toBe('LIDL / Homebargains, Darlington');
    expect(placeQuery({ ...base, id: 'b', label: 'South Park, Darlington', suggestedAddress: 'Parkside, Darlington, DL1 5TD' }, 'home')).toBe('South Park, Darlington');
    expect(placeQuery({ ...base, id: 'c', label: null, suggestedLabel: '97 Grange Road', suggestedAddress: '97 Grange Road, Darlington DL1 5NH' }, 'home')).toBe('97 Grange Road, Darlington DL1 5NH');
    expect(placeQuery({ ...base, id: 'd', label: 'Grandparents', kind: 'home', suggestedAddress: '1 Any Street, Town' }, 'home')).toBeNull();
    expect(placeQuery({ ...base, id: 'home', label: 'Home' }, 'home')).toBeNull();
    expect(placeQuery({ ...base, id: 'e', label: null }, 'home')).toBeNull();
  });
  it('reads only the categories it offered, for the entries it asked about', () => {
    const text = 'Here you go:\n```json\n[{"id":"1","category":"shops","type":"Discount supermarket","name":null},' +
      '{"id":"2","category":"castle","type":"Castle"},{"id":"9","category":"food","type":"Cafe"},{"id":"3","category":"HEALTH","type":"Hospital","name":"Memorial"}]\n```';
    const r = parsePlaceTypes(text, ['1', '2', '3']);
    expect([...r.keys()]).toEqual(['1', '3']);
    expect(r.get('1')).toEqual({ category: 'shops', type: 'Discount supermarket', name: null });
    expect(r.get('3')?.category).toBe('health');
    expect(parsePlaceTypes('no idea', ['1']).size).toBe(0);
  });
  it('folds every slot into one of the six colour groups', () => {
    expect(groupOf('school')).toBe('duty');
    expect(groupOf('unnamed')).toBe('about');
    expect(groupOf('travel')).toBe('travel');
  });
});

describe('analysePatterns', () => {
  const rows = people.flatMap((p) => DAYS.flatMap((d) => schoolDay(p.subject, d)));
  const steps = new Map([['alex', new Map(DAYS.map((d) => [d, 9000]))]]);
  const now = new Date('2026-09-26T12:00:00Z');

  it('reads visits, destinations and the shape of the day off the trail', async () => {
    const r = await analysePatterns(rows, places, people, steps, now, 7, 'home');
    const alex = r.people.find((p) => p.subject === 'alex')!;
    const school = alex.places.find((p) => p.placeId === 'school')!;
    expect(school).toMatchObject({ category: 'school', visits: 5, days: 5, medianTravelIn: 18, arrives: '08:18', weekdayShare: 1 });
    expect(school.medianStay).toBeGreaterThan(7 * 60);
    expect(school.with).toEqual([{ subject: 'sam', share: 1 }]);
    expect(alex.trips).toBe(10);
    expect(alex.firstOut.weekday).toBe('08:00');
    // 11:00 London on a weekday is all school; 03:00 all home.
    expect(alex.dayShape.weekday[11].school).toBe(1);
    expect(alex.dayShape.weekday[3].home).toBe(1);
    expect(alex.predictability).toBeGreaterThan(0.9);
  });

  it('finds the pair together at school and on the same journeys', async () => {
    const r = await analysePatterns(rows, places, people, steps, now, 7, 'home');
    const pair = r.together.pairs[0];
    expect(pair).toMatchObject({ a: 'alex', b: 'sam', sharedTrips: 10 });
    expect(pair.outHours).toBeGreaterThan(30);
    expect(r.household.shared[0]).toMatchObject({ placeId: 'school', people: ['alex', 'sam'] });
    // Leaving together counts once in the departures grid.
    expect(r.household.departures.flat().reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('compares steps only where it has the days, and says nothing it cannot', async () => {
    const r = await analysePatterns(rows, places, people, steps, now, 7, 'home');
    const alex = r.people.find((p) => p.subject === 'alex')!, sam = r.people.find((p) => p.subject === 'sam')!;
    expect(alex.steps).toMatchObject({ days: 5, mean: 9000, outDay: 9000, homeDay: null });
    // Every day was a school day: no days without it to compare against.
    expect(alex.steps.byCategory).toEqual([]);
    expect(sam.steps.days).toBe(0);
  });

  it('counts a gap as unseen, never as a stay', async () => {
    const gappy = rows.filter((f) => f.subject === 'alex' && !(+f.ts > Date.parse('2026-09-22T09:00:00Z') && +f.ts < Date.parse('2026-09-22T13:00:00Z')));
    const r = await analysePatterns(gappy, places, [people[0]], new Map(), now, 7, 'home');
    const school = r.people[0].places.find((p) => p.placeId === 'school')!;
    // The broken day is two short visits, not one long one through the hole.
    expect(school.visits).toBe(6);
    expect(school.hours).toBeLessThan(5 * 7.7);
  });
});
