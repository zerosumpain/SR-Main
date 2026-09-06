import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';

export interface VitalsLocation {
  lat: number;
  lon: number;
  /** Town-level label, or null when it could not be resolved. */
  town: string | null;
}

// Cold-start fallback only — used before the first successful Home Assistant
// query. `town` stays null so the hero never displays a wrong place name.
const FALLBACK: VitalsLocation = { lat: 51.5, lon: -0.1, town: null };

const HA_ENTITY = 'person.john';
const LOCATION_TTL_MS = 10 * 60 * 1000; // HA position re-query cadence
const COLD_TTL_MS = 60 * 1000; // brief cache when HA is unreachable
const GEOCODE_TTL_MS = 6 * 60 * 60 * 1000; // town name barely changes
const HTTP_TIMEOUT_MS = 8000;

let cached: { value: VitalsLocation; expires: number } | null = null;
let lastGood: VitalsLocation | null = null;
const geocodeCache = new Map<string, { town: string | null; expires: number }>();

async function getHaConfig(): Promise<{ url: string; token: string } | null> {
  try {
    const [cfg] = await db
      .select()
      .from(homeAssistantConfig)
      .where(eq(homeAssistantConfig.id, 'default'))
      .limit(1);
    if (cfg?.url && cfg?.token) {
      return { url: cfg.url.replace(/\/$/, ''), token: cfg.token };
    }
  } catch (err) {
    console.warn('[vitals-location] HA config read failed:', err);
  }
  return null;
}

async function queryHaCoords(): Promise<{ lat: number; lon: number } | null> {
  const cfg = await getHaConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.url}/api/states/${HA_ENTITY}`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const lat = data?.attributes?.latitude;
    const lon = data?.attributes?.longitude;
    if (typeof lat === 'number' && typeof lon === 'number') return { lat, lon };
  } catch (err) {
    console.warn('[vitals-location] HA query failed:', err);
  }
  return null;
}

/**
 * Town name for a coordinate.
 *
 * Deliberately still Nominatim, where `$lib/daydream/geocode` and
 * `$lib/workflows/site-tools/geocode` were moved to Mapbox. Two reasons, both
 * specific to this caller: it wants a TOWN at zoom 12, which Nominatim answers
 * as well as anything; and Mapbox's free tier forbids caching a result, so
 * switching would trade one lookup every six hours for one every ten minutes —
 * the cadence of the location cache above — and buy nothing for it.
 */
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  // Round to ~1 km so the cache is effective and Nominatim's usage policy
  // (heavy caching, low request volume) is respected.
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const now = Date.now();
  const hit = geocodeCache.get(key);
  if (hit && hit.expires > now) return hit.town;

  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: 'json',
      zoom: '12', // town / city granularity
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { 'User-Agent': 'strangeramblings.com vitals (john@strangeramblings.com)' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = await res.json();
      const a = (data?.address ?? {}) as Record<string, string>;
      const town =
        a.town ||
        a.city ||
        a.village ||
        a.hamlet ||
        a.suburb ||
        a.municipality ||
        a.county ||
        null;
      geocodeCache.set(key, { town, expires: now + GEOCODE_TTL_MS });
      return town;
    }
  } catch (err) {
    console.warn('[vitals-location] reverse geocode failed:', err);
  }
  return hit?.town ?? null;
}

/**
 * Resolve the current location from Home Assistant's `person.john`
 * entity, reverse-geocoded to a town. Coordinates are for server-side weather
 * lookup only; never expose them to clients. Falls back to the last known
 * location, then a neutral default, and never throws.
 */
export async function getVitalsLocation(): Promise<VitalsLocation> {
  const now = Date.now();
  if (cached && cached.expires > now) return cached.value;

  const coords = await queryHaCoords();
  if (!coords) {
    const fb = lastGood ?? FALLBACK;
    cached = { value: fb, expires: now + COLD_TTL_MS };
    return fb;
  }

  const town = await reverseGeocode(coords.lat, coords.lon);
  const value: VitalsLocation = { lat: coords.lat, lon: coords.lon, town };
  lastGood = value;
  cached = { value, expires: now + LOCATION_TTL_MS };
  return value;
}
