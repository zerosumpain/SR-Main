// src/lib/daydream/geocode.ts
//
// Guessing what a place is called, so naming one is a confirmation rather than
// a memory test.
//
// Distinct from `$lib/vitals/location.ts`, which reverse-geocodes at zoom 12 to
// get a TOWN for the hero copy. That is the wrong granularity here by about
// three orders of magnitude: "Darlington" is not a useful suggestion for a spot
// the owner sat in for an hour. This asks at zoom 18, which is where Nominatim
// returns the building, shop or amenity actually at the point.
//
// The suggestion is never written anywhere on its own. It fills the box, the
// owner corrects or accepts it, and THEIR answer is what becomes a memory —
// same rule as everywhere else here: `geocoded` is weaker evidence than
// `confirmed`, and only confirmed gets quoted back as fact.

import { and, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { errMsg } from './types';

/** Nominatim's usage policy asks for heavy caching and low volume. A place's
 *  name does not change, so this is generous on purpose. */
const CACHE_TTL_MS = 30 * 86_400_000;
const HTTP_TIMEOUT_MS = 10_000;

/** Identifies this caller to Nominatim, as their policy requires. */
const USER_AGENT = 'strangeramblings.com daydreaming (john@strangeramblings.com)';

export interface PlaceSuggestion {
  /** The best single name to put in the box. Null when nothing was resolvable. */
  name: string | null;
  /** A guessed `kind`, when the OSM tags imply one. */
  kind: string | null;
  /** Street-level address, for the "is this the right spot?" check. */
  address: string | null;
  /** Where it came from — shown, so a wrong guess is obviously a guess. */
  source: 'nominatim' | 'cache' | 'unavailable';
}

export const NO_SUGGESTION: PlaceSuggestion = {
  name: null,
  kind: null,
  address: null,
  source: 'unavailable',
};

/**
 * Map OSM tags onto the place kinds this feature uses.
 *
 * Only confident mappings. A tag we cannot map returns null rather than
 * guessing `other`, because a wrong pre-selected kind is worse than an unset
 * one — the owner corrects an empty field and accepts a filled one.
 */
export function kindFromOsm(
  category: string | null,
  type: string | null,
): string | null {
  const t = (type ?? '').toLowerCase();
  const c = (category ?? '').toLowerCase();

  if (t === 'cafe' || t === 'coffee_shop') return 'cafe';
  if (t === 'school' || t === 'kindergarten' || t === 'college') return 'school';
  if (t === 'gym' || t === 'fitness_centre' || t === 'sports_centre') return 'gym';
  if (c === 'shop' || t === 'supermarket' || t === 'department_store' || t === 'mall') return 'shop';
  if (t === 'office' || c === 'office') return 'work';
  if (t === 'house' || t === 'residential' || t === 'detached' || t === 'semidetached_house') {
    return 'home';
  }
  return null;
}

/**
 * The best name from a Nominatim reply.
 *
 * Order matters and is not arbitrary: `name` is the thing's actual name
 * ("Costa Coffee"), the address parts below it are progressively vaguer, and
 * falling back past the road is how you end up suggesting a county. Anything
 * vaguer than a road is not a suggestion, it is noise, so it returns null.
 */
export function pickName(data: Record<string, unknown>): { name: string | null; address: string | null } {
  const addr = (data.address ?? {}) as Record<string, string>;
  const displayName = typeof data.display_name === 'string' ? data.display_name : null;

  const name =
    (typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null) ??
    addr.shop ??
    addr.amenity ??
    addr.leisure ??
    addr.building ??
    addr.house_name ??
    null;

  // A street address for the sanity check, trimmed to something readable
  // rather than Nominatim's full comma-separated chain to the country.
  const address = displayName ? displayName.split(',').slice(0, 3).join(',').trim() : null;

  if (name) return { name, address };

  // No named feature. A house number and road is still a useful prompt —
  // it tells the owner WHERE, which is what they need to name it themselves.
  const road = addr.road ?? null;
  if (road) {
    const number = addr.house_number ? `${addr.house_number} ` : '';
    return { name: `${number}${road}`.trim(), address };
  }

  return { name: null, address };
}

/** Cache key. Six decimal places is ~0.1 m — far tighter than needed, so it is
 *  rounded to five (~1 m), which is still well inside a place's scatter. */
function cacheKey(lat: number, lon: number): string {
  return `daydream.geocode.${lat.toFixed(5)},${lon.toFixed(5)}`;
}

/**
 * What is at this point?
 *
 * Cached in `app_settings` rather than in memory: the suggestion is requested
 * from a page load, the process restarts on every deploy, and Nominatim's
 * policy is explicit about caching. A miss costs one request; a hit costs one
 * indexed read.
 */
export async function suggestPlaceName(lat: number, lon: number): Promise<PlaceSuggestion> {
  const key = cacheKey(lat, lon);

  try {
    const [cached] = await db
      .select({ value: appSettings.value, updatedAt: appSettings.updatedAt })
      .from(appSettings)
      .where(and(eq(appSettings.key, key), gte(appSettings.updatedAt, new Date(Date.now() - CACHE_TTL_MS))))
      .limit(1);
    if (cached?.value) {
      return { ...(cached.value as unknown as PlaceSuggestion), source: 'cache' };
    }
  } catch {
    // A cache read failing is not a reason to skip the lookup.
  }

  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: 'jsonv2',
      // Building / POI granularity. The vitals feed's zoom 12 gives a town, which is
      // useless for naming a spot you sat in.
      zoom: '18',
      addressdetails: '1',
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return NO_SUGGESTION;

    const data = (await res.json()) as Record<string, unknown>;
    const { name, address } = pickName(data);
    const suggestion: PlaceSuggestion = {
      name,
      kind: kindFromOsm(
        typeof data.category === 'string' ? data.category : null,
        typeof data.type === 'string' ? data.type : null,
      ),
      address,
      source: 'nominatim',
    };

    try {
      const { setSetting } = await import('$lib/server/models/settings');
      await setSetting(key, suggestion as unknown as Record<string, unknown>);
    } catch {
      // Failing to cache is not failing to answer.
    }

    return suggestion;
  } catch (err) {
    console.error('[daydream] reverse geocode failed:', errMsg(err));
    return NO_SUGGESTION;
  }
}
