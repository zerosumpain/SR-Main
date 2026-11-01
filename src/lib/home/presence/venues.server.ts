// src/lib/home/presence/venues.server.ts
//
// The OpenStreetMap features round each big place (`venues.ts`), fetched
// once and kept in app_settings by place id with the geometry asked about:
// a place redrawn is fetched again, and the map is refreshed after sixty
// days. Only big places the owner has named — a town centre, a retail park —
// and never a house: the query is a circle round somewhere public that the
// household goes, with no person, time or visit in it. OpenStreetMap data,
// © OpenStreetMap contributors, ODbL; the page says so.

import { getSetting, setSetting } from '$lib/server/models/settings';
import type { PatternPlace } from './patterns';
import { overpassQuery, poisFromOverpass, SPLIT_MIN_RADIUS_M, type Poi } from './venues';

export const VENUES_KEY = 'home.patterns.venues';
const REFRESH_MS = 60 * 86_400_000;
/** Overpass is a shared public service: a few places a run, one at a time. */
const MAX_FETCHES = 6;

type VenueCache = Record<string, { lat: number; lon: number; radiusM: number; at: string; pois: Poi[] }>;

/** A circle wider than this is a city, not a centre: thousands of features, and a stop in it says little. */
const SPLIT_MAX_RADIUS_M = 600;

/** Named, big enough to hold several businesses, not a house, and not itself a café. */
export const splittable = (p: PatternPlace, homeId: string | null) =>
  p.id !== homeId && p.kind !== 'home' && p.kind !== 'cafe' && p.lookup?.category !== 'food' && !!p.label
  && p.radiusM >= SPLIT_MIN_RADIUS_M && p.radiusM <= SPLIT_MAX_RADIUS_M;

/** Attach each big place's map, fetching the ones missing or stale first. */
export async function attachVenues(places: PatternPlace[], homeId: string | null, now = new Date()): Promise<number> {
  const cache = (await getSetting<VenueCache>(VENUES_KEY).catch(() => null)) ?? {};
  const fresh = (p: PatternPlace) => {
    const c = cache[p.id];
    return !!c && c.lat === p.lat && c.lon === p.lon && c.radiusM === p.radiusM && +now - Date.parse(c.at) < REFRESH_MS;
  };
  let fetched = 0;
  const { overpass } = await import('$lib/trips/research.server');
  for (const p of places.filter((x) => splittable(x, homeId) && !fresh(x)).slice(0, MAX_FETCHES)) {
    const answer = await overpass(overpassQuery(p.lat, p.lon, p.radiusM)).catch(() => null);
    // A busy Overpass leaves the old map in place, or none: the place is simply not split this run.
    if (!answer) continue;
    cache[p.id] = { lat: p.lat, lon: p.lon, radiusM: p.radiusM, at: now.toISOString(), pois: poisFromOverpass(answer) };
    fetched++;
  }
  if (fetched) await setSetting(VENUES_KEY, cache);
  for (const p of places) if (splittable(p, homeId) && cache[p.id]) p.pois = cache[p.id].pois;
  return fetched;
}
