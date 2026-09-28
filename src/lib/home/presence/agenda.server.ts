// src/lib/home/presence/agenda.server.ts
//
// "Coming up" on /home/people: the owner's calendar for the next two days,
// planned against the learned routes (`agenda.ts`). This file does the I/O the
// pure planner cannot: read the diary (with the owner's exclusions), put each
// event location on the map (Mapbox forward geocoding, the same credential and
// Origin rule as the reverse lookup), and time journeys nobody has made
// (openrouteservice, through the secret registry). Both lookups are cached in
// `app_settings` — a location or a pair of points is asked about once a month,
// not on every 30-second refresh.
//
// OWNER ONLY. The calendar is the owner's credential; the caller checks.

import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings, daydreamPlaces } from '$lib/db/schema';
import { getCredential, listCredentials } from '$lib/integrations/credentials';
import { errMsg } from './types';
import { listMembers } from './members';
import {
  planAgenda,
  type AgendaEvent,
  type AgendaItem,
  type AgendaPlace,
  type CalendarMap,
  type GeoPoint,
  type RouteRequest,
  type RoutedTime,
} from './agenda';
import type { LiveState, RouteInsight } from './insights';
import { DEFAULT_SUBJECT } from './types';

export const CALENDAR_MAP_KEY = 'home.agenda.calendars';
const GEO_CACHE_KEY = 'home.agenda.geo';
const ROUTE_CACHE_KEY = 'home.agenda.routes';
const CACHE_TTL_MS = 30 * 86_400_000;
const CACHE_MAX = 400;
/** Lookups per read: a diary full of new places fills over a few refreshes, never in one burst. */
const MAX_LOOKUPS = 6;

type Cached<T> = Record<string, { at: number; value: T | null }>;

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return (row?.value as T | undefined) ?? fallback;
}
async function writeSetting(key: string, value: unknown): Promise<void> {
  await db.insert(appSettings).values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
function prune<T>(cache: Cached<T>): Cached<T> {
  const fresh = Object.entries(cache).filter(([, v]) => Date.now() - v.at < CACHE_TTL_MS);
  return Object.fromEntries(fresh.sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX));
}

export async function loadCalendarMap(): Promise<CalendarMap> {
  return readSetting<CalendarMap>(CALENDAR_MAP_KEY, {});
}
export async function saveCalendarMap(map: CalendarMap): Promise<void> {
  await writeSetting(CALENDAR_MAP_KEY, map);
}

// ── Geocoding (forward) ─────────────────────────────────────────────────────

async function mapboxKey(): Promise<string | null> {
  const credentials = await listCredentials('mapbox');
  credentials.sort((a, b) => +b.createdAt - +a.createdAt);
  if (!credentials.length) return null;
  const credential = await getCredential<'apikey'>(credentials[0].id);
  return credential?.kind === 'apikey' && credential.payload.key ? credential.payload.key : null;
}

/** Near home first: "the leisure centre" means the one in town, not one 300 miles away. */
async function forwardGeocode(text: string, near: { lat: number; lon: number } | null, key: string): Promise<GeoPoint | null> {
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', text);
  url.searchParams.set('access_token', key);
  url.searchParams.set('limit', '1');
  url.searchParams.set('country', 'gb');
  url.searchParams.set('language', 'en');
  if (near) url.searchParams.set('proximity', `${near.lon},${near.lat}`);
  const origin = new URL(process.env.PUBLIC_BASE_URL?.trim() || process.env.PUBLIC_SITE_URL?.trim() || process.env.ORIGIN?.trim() || 'https://strangeramblings.com').origin;
  const res = await fetch(url, { headers: { Origin: origin, Referer: `${origin}/` }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`geocoder ${res.status}`);
  const data = (await res.json()) as { features?: Array<{ geometry?: { coordinates?: number[] }; properties?: { name?: string; full_address?: string } }> };
  const f = data.features?.[0];
  const c = f?.geometry?.coordinates;
  if (!c || c.length < 2 || !c.every(Number.isFinite)) return null;
  return { lon: c[0], lat: c[1], label: String(f?.properties?.name ?? text).slice(0, 80) };
}

// ── Routing ─────────────────────────────────────────────────────────────────

async function orsHeaders(url: string): Promise<Record<string, string> | null> {
  try {
    const { resolveSecretForUrl } = await import('$lib/secrets/registry');
    return (await resolveSecretForUrl('openrouteservice', url, 'POST')).headers;
  } catch (err) {
    if (!/no secret registered/i.test(errMsg(err))) throw err;
  }
  return process.env.ORS_API_KEY ? { Authorization: process.env.ORS_API_KEY } : null;
}

async function route(req: RouteRequest): Promise<RoutedTime | null> {
  const url = `https://api.openrouteservice.org/v2/directions/${req.profile}`;
  const headers = await orsHeaders(url);
  if (!headers) throw new Error('no openrouteservice credential');
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ coordinates: [[req.from.lon, req.from.lat], [req.to.lon, req.to.lat]] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`router ${res.status}`);
  const data = (await res.json()) as { routes?: Array<{ summary?: { duration?: number; distance?: number } }> };
  const s = data.routes?.[0]?.summary;
  if (!s || !Number.isFinite(s.duration)) return null;
  return { minutes: (s.duration ?? 0) / 60, metres: s.distance ?? 0, profile: req.profile };
}

// ── The read ────────────────────────────────────────────────────────────────

const CALENDAR_TTL_MS = 5 * 60_000;
let calendarMemo: { at: number; read: Awaited<ReturnType<typeof import('$lib/calendar/read').readCalendar>> } | null = null;

export interface AgendaRead {
  items: AgendaItem[];
  /** Calendars seen in the window, for the owner's mapping. */
  calendars: string[];
  calendarMap: CalendarMap;
  /** Timed events with no location — shown as a count, never guessed. */
  unlocated: number;
  available: boolean;
  partial: boolean;
  error: string | null;
}

export async function loadAgenda(input: {
  routes: RouteInsight[];
  live: LiveState[];
  homeId: string | null;
  now?: Date;
}): Promise<AgendaRead> {
  const now = input.now ?? new Date();
  const [{ readCalendar }, { loadExclusionSet }] = await Promise.all([
    import('$lib/calendar/read'),
    import('$lib/calendar/store'),
  ]);
  // The page refreshes every 30 s and the heartbeat every 2 min; the diary is
  // a CalDAV round trip. Five minutes old is fresh enough to plan a journey.
  if (!calendarMemo || +now - calendarMemo.at > CALENDAR_TTL_MS || !calendarMemo.read.available) {
    calendarMemo = { at: +now, read: await readCalendar({ dateRangeStart: 'today', dateRangeEnd: '+2d' }, await loadExclusionSet()) };
  }
  const read = calendarMemo.read;
  const calendarMap = await loadCalendarMap();
  if (!read.available) {
    return { items: [], calendars: [], calendarMap, unlocated: 0, available: false, partial: false, error: read.error };
  }
  const events: AgendaEvent[] = read.events.map((e, i) => ({
    id: e.id && e.uid ? `${e.uid}:${e.start}` : `${i}:${e.start}`,
    title: e.title, start: e.start, end: e.end, location: e.location, calendar: e.calendar,
  }));
  const [members, placeRows] = await Promise.all([
    listMembers(),
    db.select({
      id: daydreamPlaces.id, label: daydreamPlaces.label, suggestedLabel: daydreamPlaces.suggestedLabel,
      kind: daydreamPlaces.kind, lat: daydreamPlaces.lat, lon: daydreamPlaces.lon, radiusM: daydreamPlaces.radiusM,
    }).from(daydreamPlaces).where(inArray(daydreamPlaces.status, ['active'])),
  ]);
  const places: AgendaPlace[] = placeRows;
  const people = members.map((m) => ({ subject: m.subject, displayName: m.displayName }));
  const home = input.homeId ? places.find((p) => p.id === input.homeId) ?? null : null;

  // Geocode the locations no place name explains, a few per read.
  const geoCache = prune(await readSetting<Cached<GeoPoint>>(GEO_CACHE_KEY, {}));
  const geos = new Map<string, GeoPoint | null>();
  let lookups = 0, geoDirty = false, key: string | null | undefined;
  for (const loc of new Set(events.map((e) => e.location?.trim()).filter((l): l is string => !!l))) {
    const hit = geoCache[loc];
    if (hit) { geos.set(loc, hit.value); continue; }
    if (lookups >= MAX_LOOKUPS) continue;
    key = key === undefined ? await mapboxKey().catch(() => null) : key;
    if (!key) break;
    lookups++;
    try {
      const point = await forwardGeocode(loc, home, key);
      geoCache[loc] = { at: Date.now(), value: point };
      geos.set(loc, point);
      geoDirty = true;
    } catch (err) {
      // URLs carry the token: log the fact, never the request.
      console.error('[home/agenda] geocode failed:', errMsg(err).slice(0, 40));
    }
  }
  if (geoDirty) await writeSetting(GEO_CACHE_KEY, geoCache).catch(() => {});

  const base = {
    events, people, places, geos, routes: input.routes, live: input.live, homeId: input.homeId,
    ownerSubject: members.find((m) => m.subject === DEFAULT_SUBJECT)?.subject ?? members[0]?.subject ?? DEFAULT_SUBJECT,
    calendarMap, now,
  };
  const routeCache = prune(await readSetting<Cached<RoutedTime>>(ROUTE_CACHE_KEY, {}));
  const routed = new Map(Object.entries(routeCache).filter(([, v]) => v.value).map(([k, v]) => [k, v.value!]));
  let plan = planAgenda({ ...base, routed });
  if (plan.requests.length) {
    let dirty = false;
    for (const req of plan.requests.slice(0, MAX_LOOKUPS)) {
      try {
        const answer = await route(req);
        routeCache[req.key] = { at: Date.now(), value: answer };
        if (answer) routed.set(req.key, answer);
        dirty = true;
      } catch (err) {
        console.error('[home/agenda] route failed:', errMsg(err).slice(0, 80));
        break;
      }
    }
    if (dirty) {
      await writeSetting(ROUTE_CACHE_KEY, routeCache).catch(() => {});
      plan = planAgenda({ ...base, routed });
    }
  }
  const timed = read.events.filter((e) => /T\d/.test(e.start));
  return {
    items: plan.items,
    calendars: [...new Set(read.events.map((e) => e.calendar).filter((c): c is string => !!c))].sort(),
    calendarMap,
    unlocated: timed.filter((e) => !e.location?.trim() && +new Date(e.end ?? e.start) >= +now).length,
    available: true,
    partial: read.partial || read.truncated,
    error: null,
  };
}
