import { describe, expect, it } from 'vitest';
import { assignSubjects, isAllDay, matchPlace, planAgenda, routeKey, routedEstimate, type AgendaInput, type AgendaPlace } from './agenda';
import type { RouteInsight } from './insights';

const people = [
  { subject: 'alex', displayName: 'Alex' },
  { subject: 'sam', displayName: 'Sam' },
];
const places: AgendaPlace[] = [
  { id: 'home', label: 'Home', kind: 'home', lat: 51.5, lon: -0.12, radiusM: 60 },
  { id: 'school', label: 'Sample College', kind: 'school', lat: 51.51, lon: -0.12, radiusM: 110 },
  { id: 'pool', label: 'Leisure Centre', kind: 'other', lat: 51.53, lon: -0.12, radiusM: 100 },
];
const schoolRoute: RouteInsight = {
  id: 'sam:home:school:vehicle', subject: 'sam', person: 'Sam', fromId: 'home', toId: 'school', from: 'Home', to: 'Sample College',
  samples: 5, average: 16, median: 16, low: 14, high: 18, departure: '08:20', morning: 5, mode: 'vehicle', broken: 0,
  trips: [14, 15, 16, 17, 18].map((m, i) => ({ start: `2026-09-2${i}T07:20:00Z`, minutes: m, broken: false })),
};
const base = (over: Partial<AgendaInput> = {}): AgendaInput => ({
  events: [], people, places, geos: new Map(), routes: [schoolRoute], routed: new Map(), live: [],
  homeId: 'home', ownerSubject: 'alex', calendarMap: {}, now: new Date('2026-09-28T06:00:00Z'), ...over,
});

describe('who is going', () => {
  it('uses the owner’s calendar mapping first, then names in the title, then the owner', () => {
    expect(assignSubjects({ title: 'Dentist', calendar: 'Kids' }, people, { Kids: ['sam'] }, 'alex')).toEqual({ subjects: ['sam'], by: 'calendar' });
    expect(assignSubjects({ title: "Sam's dentist", calendar: 'Home' }, people, {}, 'alex')).toEqual({ subjects: ['sam'], by: 'title' });
    expect(assignSubjects({ title: 'Samba class', calendar: null }, people, {}, 'alex')).toEqual({ subjects: ['alex'], by: 'owner' });
    expect(assignSubjects({ title: 'Standup', calendar: 'Work' }, people, { Work: [] }, 'alex').subjects).toEqual([]);
  });
});

describe('where it is', () => {
  it('matches a place by the longest name in the location, else by the geocoded point', () => {
    expect(matchPlace('Sample College, High St', places, null)?.id).toBe('school');
    expect(matchPlace('12 Some Road', places, { lat: 51.5301, lon: -0.1201, label: '12 Some Road' })?.id).toBe('pool');
    expect(matchPlace('Somewhere new', places, { lat: 52, lon: -1, label: 'x' })).toBeNull();
  });
  it('skips all-day events', () => {
    expect(isAllDay({ start: '2026-09-29', end: '2026-09-30' })).toBe(true);
    expect(isAllDay({ start: '2026-09-29T00:00:00Z', end: '2026-09-30T00:00:00Z' })).toBe(true);
    expect(isAllDay({ start: '2026-09-29T15:00:00Z', end: '2026-09-29T16:00:00Z' })).toBe(false);
  });
});

describe('the plan', () => {
  it('times a known journey from the person’s own trips and sets leave-by at p80', () => {
    const { items, requests } = planAgenda(base({
      events: [{ id: 'e1', title: 'Sam parents evening', start: '2026-09-28T16:00:00Z', end: '2026-09-28T17:00:00Z', location: 'Sample College', calendar: 'Home' }],
    }));
    expect(requests).toEqual([]);
    expect(items[0]).toMatchObject({ subjects: ['sam'], assignedBy: 'title', place: { id: 'school' }, origin: { id: 'home', why: 'home' } });
    expect(items[0].travel).toMatchObject({ source: 'person', samples: 5 });
    expect(+new Date(items[0].leaveBy!)).toBe(+new Date('2026-09-28T16:00:00Z') - Math.ceil(items[0].travel!.p80) * 60_000);
  });
  it('asks the router for a journey nobody has made, then uses its answer', () => {
    const events = [{ id: 'e2', title: 'Swimming', start: '2026-09-28T17:00:00Z', end: '2026-09-28T18:00:00Z', location: 'Leisure Centre', calendar: null }];
    const first = planAgenda(base({ events }));
    expect(first.items[0].travel).toBeNull();
    expect(first.requests).toHaveLength(1);
    expect(first.requests[0].profile).toBe('driving-car');
    const routed = new Map([[first.requests[0].key, { minutes: 10, metres: 3400, profile: 'driving-car' as const }]]);
    const second = planAgenda(base({ events, routed }));
    expect(second.requests).toEqual([]);
    expect(second.items[0].travel).toMatchObject({ source: 'routed', median: 12 });
  });
  it('sets off from the previous engagement, and flags a connection too tight to make', () => {
    const { items } = planAgenda(base({
      events: [
        { id: 'a', title: 'Sam school play', start: '2026-09-28T15:00:00Z', end: '2026-09-28T16:50:00Z', location: 'Sample College', calendar: null },
        { id: 'b', title: 'Sam swimming', start: '2026-09-28T17:00:00Z', end: '2026-09-28T18:00:00Z', location: 'Leisure Centre', calendar: null },
      ],
      routed: new Map([[routeKey(places[1], places[2], 'foot-walking'), { minutes: 25, metres: 2200, profile: 'foot-walking' as const }]]),
    }));
    expect(items[1].origin).toMatchObject({ id: 'school', why: 'previous' });
    expect(items[1].issue?.kind).toBe('tight');
  });
  it('flags two overlapping engagements in different places', () => {
    const { items } = planAgenda(base({
      events: [
        { id: 'a', title: 'Alex meeting', start: '2026-09-28T15:00:00Z', end: '2026-09-28T16:00:00Z', location: 'Sample College', calendar: null },
        { id: 'b', title: 'Alex swim', start: '2026-09-28T15:30:00Z', end: '2026-09-28T16:30:00Z', location: 'Leisure Centre', calendar: null },
      ],
    }));
    expect(items[1].issue?.kind).toBe('overlap');
  });
  it('keeps an unplaceable location and says so, and drops past and locationless events', () => {
    const { items } = planAgenda(base({
      events: [
        { id: 'x', title: 'Coffee', start: '2026-09-28T10:00:00Z', end: null, location: 'Somewhere vague', calendar: null },
        { id: 'y', title: 'Call', start: '2026-09-28T10:00:00Z', end: null, location: null, calendar: null },
        { id: 'z', title: 'Gone', start: '2026-09-27T10:00:00Z', end: '2026-09-27T11:00:00Z', location: 'Sample College', calendar: null },
      ],
    }));
    expect(items.map((i) => i.id)).toEqual(['x']);
    expect(items[0].issue?.kind).toBe('unplaced');
  });
  it('widens a router’s time into a range the family actually sees', () => {
    const e = routedEstimate({ minutes: 20, metres: 9000, profile: 'driving-car' });
    expect(e.low).toBeLessThan(e.median);
    expect(e.p80).toBeGreaterThan(e.median);
    expect(e.high).toBeGreaterThan(e.p80);
  });
});
