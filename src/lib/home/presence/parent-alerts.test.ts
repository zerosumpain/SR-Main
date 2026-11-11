import { describe, expect, it } from 'vitest';
import type { HouseholdMember } from './members';
import type { InsightPlace, LiveState, RouteInsight } from './insights';
import type { Routine, SchoolCalendar } from './forecast';
import { guardiansByChild, LATE_TOLERANCE_MINS, schoolLateNotices, stopNotices } from './parent-alerts';

const member = (subject: string, email: string | null, guardianOf: string[] = []): HouseholdMember => ({
  subject, email, displayName: subject[0].toUpperCase() + subject.slice(1), source: 'companion',
  haPersonEntity: null, whatsapp: null, alerts: {}, guardianOf,
});
const members = [member('john', 'John@Example.test', ['rory']), member('katie', 'katie@example.test', ['rory']), member('rory', 'rory@example.test')];
const guardians = guardiansByChild(members);
const names = new Map([['rory', 'Rory'], ['john', 'John']]);
const place = (id: string, label: string | null, kind = 'unknown'): InsightPlace => ({ id, label, kind, lat: 51.5, lon: -0.1, radiusM: 100 });
const places = [place('home', 'Home', 'home'), place('school', 'Hillside School', 'school'), place('spot', null)];

// Wednesday 4 November 2026, 09:00 in London (GMT, so also 09:00Z).
const now = new Date('2026-11-04T09:00:00Z');

describe('guardiansByChild', () => {
  it('lists each child under every guardian, lower-cased, never a guardian of themselves', () => {
    expect(guardians.get('rory')).toEqual(['john@example.test', 'katie@example.test']);
    expect(guardiansByChild([member('john', 'j@x.test', ['john'])]).size).toBe(0);
  });
});

const route = (subject: string, toId: string, start: string, minutes: number): RouteInsight => ({
  id: `${subject}:home:${toId}`, subject, person: subject, fromId: 'home', toId, from: 'Home', to: toId,
  samples: 1, average: minutes, median: minutes, low: minutes, high: minutes, departure: '08:00', morning: 0, mode: 'active',
  broken: 0, trips: [{ start, minutes, broken: false }],
});

describe('stopNotices', () => {
  it("tells a child's guardians about a trip that ended in the last 45 minutes, as an ordinary push", () => {
    const [n] = stopNotices({ routes: [route('rory', 'school', '2026-11-04T08:20:00Z', 24)], places, guardians, names, now });
    expect(n).toMatchObject({ kind: 'stopped', subject: 'rory', recipients: ['john@example.test', 'katie@example.test'] });
    expect(n.push).toMatchObject({ title: 'Rory stopped at Hillside School', level: 'active', category: 'household' });
    expect(n.push.body).toBe('Since 08:44, 24 min after leaving Home.');
    expect(n.push.userInfo).toMatchObject({ kind: 'stopped', url: '/home/people?person=rory' });
  });
  it('says so when the stop is somewhere new', () => {
    const [n] = stopNotices({ routes: [route('rory', 'spot', '2026-11-04T08:30:00Z', 12)], places, guardians, names, now });
    expect(n.push.title).toBe('Rory stopped somewhere new');
  });
  it('keeps a looked-up label out of the event: the push names it, the event does not', () => {
    const looked = [...places, { ...place('looked', null), suggestedLabel: 'Synthetic Rise' }];
    const [n] = stopNotices({ routes: [route('rory', 'looked', '2026-11-04T08:30:00Z', 12)], places: looked, guardians, names, now });
    expect(n.push.title).toBe('Rory stopped at Synthetic Rise');
    expect(n.place).toBeUndefined();
    expect(n.eventTitle).toBe('Rory stopped somewhere');
    const [own] = stopNotices({ routes: [route('rory', 'school', '2026-11-04T08:20:00Z', 24)], places, guardians, names, now });
    expect(own).toMatchObject({ place: 'Hillside School', eventTitle: 'Rory stopped at Hillside School' });
  });
  it('ignores old trips, and anyone who is not somebody\'s child', () => {
    expect(stopNotices({ routes: [route('rory', 'school', '2026-11-04T07:30:00Z', 20)], places, guardians, names, now })).toEqual([]);
    expect(stopNotices({ routes: [route('john', 'school', '2026-11-04T08:40:00Z', 10)], places, guardians, names, now })).toEqual([]);
  });
  it('gives the same id on every run, so a stop is told once', () => {
    const a = stopNotices({ routes: [route('rory', 'school', '2026-11-04T08:20:00Z', 24)], places, guardians, names, now });
    const b = stopNotices({ routes: [route('rory', 'school', '2026-11-04T08:20:00Z', 24)], places, guardians, names, now: new Date(+now + 120_000) });
    expect(a[0].id).toBe(b[0].id);
  });
  it('leaves out a guardian an "arrived safely" already told about that trip', () => {
    const r = route('rory', 'school', '2026-11-04T08:20:00Z', 24);
    const arrived = Date.parse('2026-11-04T08:44:00Z');
    const [n] = stopNotices({ routes: [r], places, guardians, names, now, covered: new Map([[`rory-${arrived}`, ['john@example.test']]]) });
    expect(n.recipients).toEqual(['katie@example.test']);
    expect(stopNotices({ routes: [r], places, guardians, names, now, covered: new Map([[`rory-${arrived}`, ['john@example.test', 'katie@example.test']]]) })).toEqual([]);
  });
  it('leaves out a guardian already pushed "arrived at" that place for the trip, and only that place and trip', () => {
    const r = route('rory', 'school', '2026-11-04T08:20:00Z', 24);
    const crossing = Date.parse('2026-11-04T08:41:00Z'); // the first fix inside, before the dwell ended the trip
    const [n] = stopNotices({ routes: [r], places, guardians, names, now,
      arrivals: [{ subject: 'rory', placeId: 'school', at: crossing, to: ['John@Example.test'] }] });
    expect(n.recipients).toEqual(['katie@example.test']);
    // Another place, or yesterday's arrival there, says nothing about this stop.
    const other = stopNotices({ routes: [r], places, guardians, names, now, arrivals: [
      { subject: 'rory', placeId: 'home', at: crossing, to: ['john@example.test'] },
      { subject: 'rory', placeId: 'school', at: crossing - 86_400_000, to: ['john@example.test'] },
    ] });
    expect(other[0].recipients).toEqual(['john@example.test', 'katie@example.test']);
  });
});

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r-school', routeId: 'rory:home:school', subject: 'rory', person: 'Rory', fromId: 'home', toId: 'school',
  from: 'Home', to: 'Hillside School', mode: 'active', dayType: 'weekday', departure: '08:10', departureMin: 490,
  // Leaves 08:00–08:20, takes up to 20 min: usually there by 08:40.
  window: [480, 500], days: 14, of: 16, minutes: { median: 18, low: 15, high: 20, p80: 20 },
  dates: ['2026-11-03'], ...over,
});
const cal: SchoolCalendar = { holidays: [], schoolIds: new Set(['school']) };
const live = (over: Partial<LiveState> = {}): LiveState[] => [{ subject: 'rory', placeId: 'home', since: '2026-11-04T07:00:00Z', lastSeen: '2026-11-04T08:58:00Z', moving: null, ...over }];

describe('schoolLateNotices', () => {
  it('is time-sensitive when a dependable school routine is well past its usual arrival', () => {
    const [n] = schoolLateNotices({ routines: [routine()], live: live(), places, guardians, names, cal, now });
    expect(n).toMatchObject({ kind: 'school-late', recipients: ['john@example.test', 'katie@example.test'] });
    expect(n.push).toMatchObject({ title: "Rory isn't at Hillside School yet", level: 'time-sensitive' });
    expect(n.push.body).toBe('Usually there by 08:40 (14 of 16 weekdays). At Home at 08:58.');
    expect(n).toMatchObject({ place: 'Hillside School', eventTitle: "Rory isn't at Hillside School yet" });
  });
  it('keeps a looked-up school label out of the event', () => {
    const looked = places.map((p) => (p.id === 'school' ? { ...p, label: null, suggestedLabel: 'Synthetic Rise' } : p));
    const [n] = schoolLateNotices({ routines: [routine()], live: live(), places: looked, guardians, names, cal, now });
    expect(n.push.title).toBe("Rory isn't at Synthetic Rise yet");
    expect(n.place).toBeUndefined();
    expect(n.eventTitle).toBe("Rory isn't at school yet");
  });
  it(`waits out the tolerance (${LATE_TOLERANCE_MINS} min)`, () => {
    expect(schoolLateNotices({ routines: [routine()], live: live(), places, guardians, names, cal, now: new Date('2026-11-04T08:50:00Z') })).toEqual([]);
  });
  it('is silent once they have arrived today, or are there now', () => {
    expect(schoolLateNotices({ routines: [routine({ dates: ['2026-11-04'] })], live: live(), places, guardians, names, cal, now })).toEqual([]);
    expect(schoolLateNotices({ routines: [routine()], live: live({ placeId: 'school' }), places, guardians, names, cal, now })).toEqual([]);
  });
  it('a lift from somewhere else counts as arriving', () => {
    const other = routine({ id: 'r-gran', fromId: 'gran', days: 3, of: 16, dates: ['2026-11-04'] });
    expect(schoolLateNotices({ routines: [routine(), other], live: live({ placeId: null }), places, guardians, names, cal, now })).toEqual([]);
  });
  it('is silent on a holiday, at the weekend, and for a routine kept less than half the time', () => {
    const half: SchoolCalendar = { ...cal, holidays: [{ from: '2026-11-02', to: '2026-11-06' }] };
    expect(schoolLateNotices({ routines: [routine()], live: live(), places, guardians, names, cal: half, now })).toEqual([]);
    expect(schoolLateNotices({ routines: [routine()], live: live(), places, guardians, names, cal, now: new Date('2026-11-07T09:00:00Z') })).toEqual([]);
    expect(schoolLateNotices({ routines: [routine({ days: 5, of: 16 })], live: live(), places, guardians, names, cal, now })).toEqual([]);
  });
  it('is silent once a parent said "not today"', () => {
    const corrections = [{ subject: 'rory', kind: 'routine' as const, routineId: 'r-school', departedAt: null, date: '2026-11-04' }];
    expect(schoolLateNotices({ routines: [routine()], live: live(), places, guardians, names, cal, now, corrections })).toEqual([]);
  });
  it('says when the phone has gone quiet, since that reads the same as a flat battery', () => {
    const [n] = schoolLateNotices({ routines: [routine()], live: live({ lastSeen: '2026-11-04T08:05:00Z' }), places, guardians, names, cal, now });
    expect(n.push.body).toContain('No location since 08:05 (Home)');
  });
  it('is silent when they were last seen far from the school: a holiday nobody entered', () => {
    const positions = new Map([['rory', { lat: 41.9, lon: 12.5 }]]);
    expect(schoolLateNotices({ routines: [routine()], live: live({ placeId: null }), places, guardians, names, cal, now, positions })).toEqual([]);
    const near = new Map([['rory', { lat: 51.51, lon: -0.1 }]]);
    expect(schoolLateNotices({ routines: [routine()], live: live(), places, guardians, names, cal, now, positions: near })).toHaveLength(1);
  });
  it('is one notice per child and school per day', () => {
    const a = schoolLateNotices({ routines: [routine()], live: live(), places, guardians, names, cal, now });
    const b = schoolLateNotices({ routines: [routine()], live: live(), places, guardians, names, cal, now: new Date(+now + 600_000) });
    expect(a[0].id).toBe(b[0].id);
  });
});
