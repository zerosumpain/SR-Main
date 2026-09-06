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
// TWO PROVIDERS, IN THIS ORDER, and the order is the point:
//
//   1. MAPBOX, whenever an API token is registered. The account's free tier
//      carries 100,000 geocodes a month at 1,000 a minute, its address matching
//      is better than Nominatim's on anything with a house number, and it has no
//      courtesy rate limit to serialise behind. This is the primary route.
//   2. NOMINATIM (OpenStreetMap), when Mapbox is unconfigured, out of quota or
//      unwell. Free, no key, no account, and the geocoder this repo already uses
//      in two other places — `$lib/vitals/location` reverse-geocodes at zoom 12
//      for a town, `$lib/daydream/geocode` at zoom 18 for a building. It is a
//      real fallback rather than dead weight: it is also the only one of the two
//      whose answers we may keep, and this keeps their conventions — the same
//      identifying User-Agent, the same long cache, and the same rule that a
//      failed lookup returns null rather than throwing.
//
// WHICH IS WHY THE CACHE IS NOMINATIM-ONLY. Mapbox's free tier is TEMPORARY
// geocoding, and its terms allow a result to be shown to whoever asked and then
// thrown away — not written to a database. Permanent geocoding, which may be
// stored, needs a card on file. So a Mapbox hit is returned and forgotten, and
// only a Nominatim hit is written to `app_settings`. See
// MAPBOX_GEOCODES_ARE_TEMPORARY in `$lib/maps/mapbox-api`, and do not "fix" the
// asymmetry below by caching both.
//
// NOMINATIM'S USAGE POLICY IS A HARD CONSTRAINT, not advice. It asks for at most
// one request a second from a single source, a real User-Agent, and heavy
// caching. Break it and the IP is blocked — which would take the landing hero
// copy and the daydream place names down with it, not just this. Hence the
// serialised queue below, and hence the cache being consulted before any
// Nominatim request is made.

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
  /** The provider's own label, so a wrong hit is visible rather than silent. */
  label: string;
  /**
   * Which route answered. Reported rather than hidden because it is the one
   * thing that explains a difference in precision between two otherwise
   * identical lookups — and because `mapbox` is the flag that forbids caching.
   */
  source: 'mapbox' | 'nominatim' | 'cache';
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
 * Ask Mapbox. Returns null for "could not answer", never throws.
 *
 * Every failure mode collapses to the same answer on purpose: no token
 * registered, a token bound to the wrong host, the monthly free tier spent, a
 * timeout, or a name Mapbox simply does not know. The caller's next move is
 * identical in all five cases — try Nominatim — so distinguishing them here
 * would only give the caller a decision it has no use for.
 *
 * A mis-bound token is the one worth seeing in a log, because it looks exactly
 * like "Mapbox is not set up" from the outside and is fixed somewhere entirely
 * different, so it warns once per occurrence rather than passing silently.
 */
async function viaMapbox(
  text: string,
  near?: [number, number],
): Promise<GeocodedPlace | null> {
  try {
    const { forwardGeocode, mapboxApiConfigured, MapboxNotConfiguredError } =
      await import('$lib/maps/mapbox-api');
    // Asked first because "no token" is the ordinary state until one is
    // registered, and the alternative is a database read plus a thrown-and-
    // caught exception on every single lookup. The miss is memoised there.
    if (!(await mapboxApiConfigured())) return null;
    try {
      const [best] = await forwardGeocode(text, near ? { near } : {});
      if (!best) return null;
      return { lat: best.lat, lng: best.lng, label: best.label || text, source: 'mapbox' };
    } catch (err) {
      if (!(err instanceof MapboxNotConfiguredError)) {
        console.warn('[geocode] mapbox lookup failed, falling back:', (err as Error)?.message);
      }
      return null;
    }
  } catch {
    // The module itself failed to load — nothing to fall back FROM.
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
 * not exist, a timeout, or an error from BOTH providers. A map that silently
 * plots the wrong point is the failure this module exists to prevent, so it
 * never invents a fallback coordinate.
 *
 * Mapbox is asked first and its answer is never cached; the cache is consulted
 * only on the fallback path, where it is both allowed and required. That order
 * is what makes "Mapbox is primary" true rather than decorative — a cache-first
 * lookup would let one old Nominatim answer outrank Mapbox for ninety days.
 */
export async function geocodePlace(
  query: string,
  opts: { near?: [number, number] } = {},
): Promise<GeocodedPlace | null> {
  const text = (query ?? '').trim();
  if (text.length < 2) return null;

  const primary = await viaMapbox(text, opts.near);
  if (primary) return primary;

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

  // Only ever a Nominatim hit reaches here — Mapbox returns above, uncached, and
  // that is a licence term rather than a performance choice. See the header.
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
 *
 * The second-long slots only bind the Nominatim path. With a Mapbox token
 * registered a twelve-place map costs twelve quick round trips instead of the
 * thirteen seconds the queue used to impose, which is the single most visible
 * effect of making Mapbox primary.
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
