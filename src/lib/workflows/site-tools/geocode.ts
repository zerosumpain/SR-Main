// src/lib/workflows/site-tools/geocode.ts
//
// Turning a place NAME into coordinates, so a map plots where the model meant
// rather than where it guessed.
//
// A model asked for "Norwich Cathedral" will happily produce a lat/lng from
// memory, and it is usually wrong by anything from a street to a county. The
// numbers look plausible either way — that is the whole problem — so the fix is
// to stop asking it for numbers at all: it names the place, this resolves it.
//
// Nominatim (OpenStreetMap) is the service. Free, no key, no account, and
// already the geocoder this repo uses in two other places — `$lib/vitals/location`
// reverse-geocodes at zoom 12 for a town, `$lib/daydream/geocode` at zoom 18 for
// a building. This is the forward direction, and the third caller, so it keeps
// their conventions: the same identifying User-Agent, the same long cache, and
// the same rule that a failed lookup returns null rather than throwing.
//
// THE USAGE POLICY IS A HARD CONSTRAINT, not advice. Nominatim asks for at most
// one request a second from a single source, a real User-Agent, and heavy
// caching. Break it and the IP is blocked — which would take the landing hero
// copy and the daydream place names down with it, not just this. Hence the
// serialised queue below, and hence the cache being the first thing consulted.

import { and, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';

/** A resolved place is a fact about the world; it does not go stale quickly. */
const CACHE_TTL_MS = 90 * 86_400_000;
const HTTP_TIMEOUT_MS = 10_000;
/** Nominatim's policy ceiling is 1 req/s. Sit under it, not on it. */
const MIN_REQUEST_GAP_MS = 1_100;

/** Identifies this caller to Nominatim, as their policy requires. */
const USER_AGENT = 'strangeramblings.com jkai (john@strangeramblings.com)';

export interface GeocodedPlace {
  lat: number;
  lng: number;
  /** Nominatim's own label, so a wrong hit is visible rather than silent. */
  label: string;
  /** Where the answer came from. `cache` and `nominatim` are equally good. */
  source: 'nominatim' | 'cache';
}

/**
 * Serialises outbound lookups across the whole process.
 *
 * A map of twelve places is twelve lookups, and firing them with `Promise.all`
 * is exactly the burst the policy forbids. Each caller awaits the previous
 * one's slot, so a batch paces itself without any caller having to know it is
 * part of a batch. Cache hits never enter this queue.
 */
let nextSlot = Promise.resolve();
function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const slot = nextSlot.then(() => fn());
  // The chain advances even when a lookup fails, or one error would wedge every
  // later caller behind a rejected promise.
  nextSlot = slot.then(
    () => new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS)),
    () => new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS)),
  );
  return slot;
}

/** Cache key. Case and surrounding space are not part of a place's identity. */
function cacheKey(query: string, near?: [number, number]): string {
  const focus = near ? `@${near[0].toFixed(2)},${near[1].toFixed(2)}` : '';
  return `geocode.fwd.${query.trim().toLowerCase().replace(/\s+/g, ' ')}${focus}`;
}

async function readCache(key: string): Promise<GeocodedPlace | null> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(
        and(eq(appSettings.key, key), gte(appSettings.updatedAt, new Date(Date.now() - CACHE_TTL_MS))),
      )
      .limit(1);
    if (!row?.value) return null;
    const hit = row.value as unknown as GeocodedPlace;
    if (typeof hit.lat !== 'number' || typeof hit.lng !== 'number') return null;
    return { ...hit, source: 'cache' };
  } catch {
    // A cache read failing is not a reason to skip the lookup.
    return null;
  }
}

/**
 * Resolve one place name to coordinates.
 *
 * `near` biases the result, which matters more than it sounds: "Newcastle"
 * without a hint is a coin flip between Tyne and Lyme, and a map centred on the
 * wrong one is worse than no map. Callers that already know roughly where they
 * are should pass it.
 *
 * Returns null for anything unresolvable — an empty query, a place that does
 * not exist, a timeout, or a Nominatim error. A map that silently plots the
 * wrong point is the failure this module exists to prevent, so it never
 * invents a fallback coordinate.
 */
export async function geocodePlace(
  query: string,
  opts: { near?: [number, number] } = {},
): Promise<GeocodedPlace | null> {
  const text = (query ?? '').trim();
  if (text.length < 2) return null;

  const key = cacheKey(text, opts.near);
  const cached = await readCache(key);
  if (cached) return cached;

  const params = new URLSearchParams({ q: text, format: 'jsonv2', limit: '1' });
  if (opts.near) {
    // A viewbox around the focus, preferred but not required — `bounded=0` keeps
    // a correct far-away answer rather than returning nothing.
    const [lat, lng] = opts.near;
    params.set('viewbox', `${lng - 1},${lat + 1},${lng + 1},${lat - 1}`);
    params.set('bounded', '0');
  }

  let hit: GeocodedPlace | null = null;
  try {
    hit = await rateLimited(async () => {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return null;
      const lat = Number(row.lat);
      const lng = Number(row.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        lat,
        lng,
        label: typeof row.display_name === 'string' ? row.display_name : text,
        source: 'nominatim' as const,
      };
    });
  } catch {
    return null;
  }

  if (hit) {
    try {
      const { setSetting } = await import('$lib/server/models/settings');
      await setSetting(key, hit as unknown as Record<string, unknown>);
    } catch {
      // Failing to cache is not failing to answer.
    }
  }
  return hit;
}

/** One entry of a batch resolve — the input place and what it became. */
export interface ResolvedPoint {
  place: string;
  hit: GeocodedPlace | null;
}

/**
 * Resolve several place names, in order.
 *
 * Sequential on purpose — see `rateLimited`. Duplicates are resolved once, both
 * because it is faster and because a route that passes through the same village
 * twice should not spend two of the second-long slots on it.
 */
export async function geocodePlaces(
  queries: string[],
  opts: { near?: [number, number] } = {},
): Promise<ResolvedPoint[]> {
  const seen = new Map<string, GeocodedPlace | null>();
  const out: ResolvedPoint[] = [];
  for (const place of queries) {
    const norm = place.trim().toLowerCase();
    if (!seen.has(norm)) seen.set(norm, await geocodePlace(place, opts));
    out.push({ place, hit: seen.get(norm) ?? null });
  }
  return out;
}
