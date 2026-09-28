// src/lib/home/presence/agenda.ts
//
// "Coming up": the owner's calendar laid over the learned routes. For each
// event with a location — who is likely going, where they will leave from,
// how long it takes (their own trips first, the household's next, a router
// last), when to leave, and whether it clashes with what comes before. PURE:
// the server reads the calendar, geocodes locations and asks the router, and
// hands everything in here, twice — once to learn which journeys need
// routing, once with the answers.
//
// Nothing here is certain and nothing claims to be. An event is assigned to a
// person by the owner's calendar mapping, else a family name in its title,
// else the owner; every item says which. A place is matched by name, else by
// geocoded distance; a routed time says it is routed.

import { metresBetween } from './cluster';
import { learnedTravel, type TravelEstimate } from './forecast';
import type { LiveState, RouteInsight } from './insights';

const MINUTE = 60_000;

export interface AgendaEvent {
  id: string;
  title: string;
  start: string;
  end: string | null;
  location: string | null;
  calendar: string | null;
}

export interface AgendaPlace {
  id: string;
  label: string | null;
  suggestedLabel?: string | null;
  kind: string;
  lat: number;
  lon: number;
  radiusM: number;
}

export interface AgendaPerson {
  subject: string;
  displayName: string;
}

/** A geocoded event location. */
export interface GeoPoint {
  lat: number;
  lon: number;
  label: string;
}

/** The owner's calendar → people mapping. `[]` means "nobody travels for this calendar". */
export type CalendarMap = Record<string, string[]>;

export type RouteProfile = 'driving-car' | 'foot-walking';

/** A router's answer for one journey. */
export interface RoutedTime {
  minutes: number;
  metres: number;
  profile: RouteProfile;
}

export interface RouteRequest {
  key: string;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  profile: RouteProfile;
}

export interface AgendaItem {
  id: string;
  title: string;
  start: string;
  end: string | null;
  location: string;
  calendar: string | null;
  subjects: string[];
  assignedBy: 'calendar' | 'title' | 'owner';
  /** Where it is: a known place, or a geocoded point, or null when the location could not be placed. */
  place: { id: string | null; label: string; lat: number; lon: number } | null;
  origin: { id: string | null; label: string; lat: number; lon: number; why: 'previous' | 'now' | 'home' } | null;
  travel: TravelEstimate | null;
  leaveBy: string | null;
  issue: { kind: 'tight' | 'overlap' | 'unplaced'; text: string } | null;
}

// ── Assignment ──────────────────────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Who is going: the owner's calendar mapping, else family names in the title, else the owner. PURE. */
export function assignSubjects(
  ev: Pick<AgendaEvent, 'title' | 'calendar'>,
  people: AgendaPerson[],
  calendarMap: CalendarMap,
  ownerSubject: string,
): { subjects: string[]; by: AgendaItem['assignedBy'] } {
  if (ev.calendar && calendarMap[ev.calendar]) {
    return { subjects: calendarMap[ev.calendar].filter((s) => people.some((p) => p.subject === s)), by: 'calendar' };
  }
  const named = people.filter((p) =>
    [p.displayName, p.subject].some((n) => n && new RegExp(`\\b${escapeRe(n)}('s)?\\b`, 'i').test(ev.title)),
  );
  if (named.length) return { subjects: named.map((p) => p.subject), by: 'title' };
  return { subjects: [ownerSubject], by: 'owner' };
}

// ── Places ──────────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The known place an event location means: a place whose name the location
 * contains (longest name wins, so "Carmel College" beats "College"), else one
 * whose circle holds the geocoded point. PURE.
 */
export function matchPlace(location: string, places: AgendaPlace[], geo: GeoPoint | null): AgendaPlace | null {
  const loc = ` ${norm(location)} `;
  const byName = places
    .map((p) => ({ p, name: norm(p.label ?? '') }))
    .filter(({ name }) => name.length >= 3 && loc.includes(` ${name} `))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (byName) return byName.p;
  if (!geo) return null;
  const near = places
    .map((p) => ({ p, d: metresBetween(geo.lat, geo.lon, p.lat, p.lon) }))
    .filter(({ p, d }) => d <= p.radiusM + 150)
    .sort((a, b) => (a.p.label ? 0 : 1) - (b.p.label ? 0 : 1) || a.d - b.d)[0];
  return near?.p ?? null;
}

/** An all-day event (a date, or midnight to midnight) is not a journey. */
export function isAllDay(ev: Pick<AgendaEvent, 'start' | 'end'>): boolean {
  if (!/T\d/.test(ev.start)) return true;
  if (!ev.end) return false;
  return +new Date(ev.end) - +new Date(ev.start) >= 23 * 60 * MINUTE;
}

// ── Routing ─────────────────────────────────────────────────────────────────

/** Under this straight-line distance a journey is routed on foot, over it by car. */
export const WALK_MAX_M = 2_500;

const q = (n: number) => n.toFixed(4);
export const routeKey = (from: { lat: number; lon: number }, to: { lat: number; lon: number }, profile: RouteProfile) =>
  `${profile}:${q(from.lat)},${q(from.lon)}>${q(to.lat)},${q(to.lon)}`;

/** A router's time as an estimate: the routed time is the median, with the range a family actually sees. */
export function routedEstimate(r: RoutedTime): TravelEstimate {
  const base = r.minutes * (r.profile === 'driving-car' ? 1.15 : 1);
  return {
    source: 'routed',
    median: Math.round(base),
    low: Math.round(base * 0.9),
    high: Math.round(base * 1.4 + 2),
    p80: Math.round(base * 1.25 + 3),
    samples: 0,
    basis: null,
    mode: r.profile === 'driving-car' ? 'vehicle' : 'active',
  };
}

// ── The plan ────────────────────────────────────────────────────────────────

export interface AgendaInput {
  events: AgendaEvent[];
  people: AgendaPerson[];
  places: AgendaPlace[];
  geos: Map<string, GeoPoint | null>;
  routes: RouteInsight[];
  routed: Map<string, RoutedTime>;
  live: LiveState[];
  homeId: string | null;
  ownerSubject: string;
  calendarMap: CalendarMap;
  now: Date;
}

/** How far back a previous engagement still decides where someone sets off from. */
const PREVIOUS_WITHIN_MINS = 3 * 60;
/** Within this, "where they are now" decides it. */
const NOW_WITHIN_MINS = 2 * 60;

/**
 * Plan every located, timed event. Returns the items and the journeys still
 * needing a router (none on the second pass). PURE.
 */
export function planAgenda(input: AgendaInput): { items: AgendaItem[]; requests: RouteRequest[] } {
  const { people, places, geos, routes, routed, live, homeId, ownerSubject, calendarMap, now } = input;
  const byId = new Map(places.map((p) => [p.id, p]));
  const home = homeId ? byId.get(homeId) ?? null : null;
  const title = (p: AgendaPlace) => p.label ?? p.suggestedLabel ?? 'Unnamed stop';
  const events = input.events
    .filter((e) => e.location?.trim() && !isAllDay(e) && +new Date(e.end ?? e.start) >= +now)
    .sort((a, b) => +new Date(a.start) - +new Date(b.start));

  const items: AgendaItem[] = [];
  const requests = new Map<string, RouteRequest>();
  for (const ev of events) {
    const { subjects, by } = assignSubjects(ev, people, calendarMap, ownerSubject);
    if (!subjects.length) continue; // mapped to nobody: the owner said this calendar is not travel
    const geo = geos.get(ev.location!.trim()) ?? null;
    const known = matchPlace(ev.location!, places, geo);
    const place = known
      ? { id: known.id, label: title(known), lat: known.lat, lon: known.lon }
      : geo
        ? { id: null, label: geo.label, lat: geo.lat, lon: geo.lon }
        : null;
    const start = +new Date(ev.start);
    const lead = subjects[0];

    // Where they set off from: their previous engagement, else where they are now, else home.
    const previous = [...items].reverse().find((i) => i.subjects.includes(lead) && i.place && i.end
      && +new Date(i.end) <= start && start - +new Date(i.end) <= PREVIOUS_WITHIN_MINS * MINUTE);
    const state = live.find((l) => l.subject === lead);
    let origin: AgendaItem['origin'] = null;
    if (previous?.place) origin = { ...previous.place, why: 'previous' };
    else if (state?.placeId && start - +now <= NOW_WITHIN_MINS * MINUTE && byId.get(state.placeId)) {
      const p = byId.get(state.placeId)!;
      origin = { id: p.id, label: title(p), lat: p.lat, lon: p.lon, why: 'now' };
    } else if (home) origin = { id: home.id, label: title(home), lat: home.lat, lon: home.lon, why: 'home' };

    let travel: TravelEstimate | null = null;
    if (place && origin && !(origin.id && origin.id === place.id)) {
      if (origin.id && place.id) travel = learnedTravel(routes, origin.id, place.id, lead);
      if (!travel) {
        const profile: RouteProfile = metresBetween(origin.lat, origin.lon, place.lat, place.lon) > WALK_MAX_M ? 'driving-car' : 'foot-walking';
        const key = routeKey(origin, place, profile);
        const answer = routed.get(key);
        if (answer) travel = routedEstimate(answer);
        else requests.set(key, { key, from: { lat: origin.lat, lon: origin.lon }, to: { lat: place.lat, lon: place.lon }, profile });
      }
    }
    const leaveBy = travel ? new Date(start - Math.ceil(travel.p80) * MINUTE).toISOString() : null;

    let issue: AgendaItem['issue'] = null;
    if (!place) issue = { kind: 'unplaced', text: `“${ev.location}” could not be placed on the map.` };
    else if (previous?.end) {
      const gap = (start - +new Date(previous.end)) / MINUTE;
      if (travel && travel.p80 > gap) {
        issue = { kind: 'tight', text: `${Math.round(gap)} min after “${previous.title}” ends; the trip usually needs ${Math.ceil(travel.p80)}.` };
      }
    }
    const overlapping = items.find((i) => i.subjects.some((s) => subjects.includes(s)) && i.end && +new Date(i.end) > start
      && i.place && place && metresBetween(i.place.lat, i.place.lon, place.lat, place.lon) > 300);
    if (overlapping) issue = { kind: 'overlap', text: `Overlaps “${overlapping.title}” somewhere else.` };

    items.push({
      id: ev.id, title: ev.title, start: ev.start, end: ev.end, location: ev.location!.trim(), calendar: ev.calendar,
      subjects, assignedBy: by, place, origin, travel, leaveBy, issue,
    });
  }
  return { items, requests: [...requests.values()] };
}
