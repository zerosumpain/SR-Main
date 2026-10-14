// src/lib/maps/mapbox-api.ts
//
// Mapbox's server-side search API, so render_map's place-name geocoding stops
// paying the Nominatim tax for work an account we already hold does better and
// faster.
//
// Restored 2026-10-01 from #871 (d6ee4eea0) for render_map. The original
// file also carried directions, isochrones, travel-time matrices and reverse
// search for the travel toolset and the daydream place-namer. Directions and
// the matrix came back on 2026-10-13 for the trip planner (`$lib/trips/
// routing.server`), with the `mapbox-api` binding in
// `$lib/secrets/credential-requests` widened to their two path prefixes.
// Isochrones and reverse search stay retired; restore them from d6ee4eea0^.
//
// DIRECTIONS AND MATRIX RESULTS ARE LIVE-ONLY. Mapbox Product Terms (21 July
// 2026) §2.10.1: "Customer shall not export, download, cache or store results
// from any request to a Navigation API" — Directions and Matrix are Navigation
// APIs. So nothing returned by `directions()` or `matrix()` may be written to
// a database, an `app_settings` cache or a stored plan. The trip planner keeps
// openrouteservice / estimated figures in its stored plans and asks Mapbox only
// for a live drive ETA shown once and thrown away. See
// MAPBOX_NAVIGATION_IS_LIVE_ONLY below.
//
// WHY THIS IS A SECOND TOKEN, and not the one in Admin → Connections.
//
// That credential is deliberately a BROWSER token: public, URL-restricted to
// this site's origins, and shipped to every visitor by /api/maps/config so a
// map can draw. Mapbox enforces those URL restrictions on the Referer, so the
// same token used from our own server — which sends no browser Referer — is
// rejected. Widening it to fix that would publish an unrestricted token to
// everyone who loads a page. So the API token is a separate row, it lives in
// the secret registry where jkai can use it but never read it, and it never
// crosses to a browser.
//
// The registry is the precedent, not an invention: the openrouteservice key is
// held exactly this way (see its spec in `$lib/secrets/credential-requests`),
// down to an env-var fallback for homeserv, which sets API_REGISTRY_DISABLED=1
// and holds no registry at all.
//
// THE FREE TIER, MEASURED (September 2026, mapbox.com/pricing):
//
//   Search Box (fwd/rev)    50,000 req/month     600 req/min
//
// Against Nominatim's one-request-per-second courtesy limit that is not a close
// call: a twelve-place map that took twelve seconds of serialised queue now
// takes one round trip.
//
// WHY SEARCH BOX AND NOT THE GEOCODING API. This is the trap in the obvious
// design. Mapbox has a Geocoding API — v6, 100,000 free a month, and the one
// every "add Mapbox geocoding" answer reaches for — and **it has no points of
// interest**. POI data was removed from it and lives in the Search Box API
// instead. Its feature types stop at `address` and `street`.
//
// Nearly everything jkai geocodes is a POI: "Norwich Cathedral", "Mousehold
// Heath", a pub, a station, an entity plucked off the intel graph. On v6 those
// resolve to nothing and fall through to Nominatim on every single call, which
// would have made "Mapbox is primary" true only for postcodes. Search Box
// answers addresses, places AND POIs, so it is the one that actually replaces
// the geocoder rather than shadowing it. `/forward` is the per-request
// endpoint and needs no session token; `/suggest` + `/retrieve` are
// the session-priced autocomplete pair and are deliberately not used here.
//
// THE ONE THING THE FREE TIER DOES NOT BUY — read before adding a cache.
//
// Mapbox search comes in two flavours. Ours is TEMPORARY, and Mapbox's terms
// are explicit that temporary results may be displayed and used in the session
// that asked for them and then thrown away — they may not be written to a
// database or cached. Permanent geocoding, which may be stored indefinitely,
// needs a card on file and is not part of the free tier.
//
// So every Mapbox result carries `source: 'mapbox'`, and the caller in
// `$lib/tools/geocode` refuses to persist one. Nominatim's results stay cacheable — its policy actively asks
// for caching — which is why the fallback is worth keeping rather than being
// dead weight. See MAPBOX_GEOCODES_ARE_TEMPORARY below.

import { env } from '$env/dynamic/private';

const BASE = 'https://api.mapbox.com';

/** The handle the owner registers the API token under at /admin/ai/apis. */
export const MAPBOX_API_SECRET_HANDLE = 'mapbox-api';

/** Local-development fallback, for the host that holds no registry. */
const ENV_VAR = 'MAPBOX_API_TOKEN';

export const MAPBOX_API_KEY_HELP =
  `Add a Mapbox token at /admin/ai/apis under the handle "${MAPBOX_API_SECRET_HANDLE}" — ` +
  'injection: query "access_token", host: api.mapbox.com, GET. ' +
  'It must be a SEPARATE token from the browser one in Admin → Connections: create it at ' +
  'account.mapbox.com/access-tokens with NO URL restriction, because a server request carries ' +
  'no Referer for Mapbox to match.';

/**
 * Whether a Mapbox result may be written to a durable cache. It may not.
 *
 * Exported as a named constant rather than left as a comment because the thing
 * it guards is a one-line temptation — the caching code is already there, and
 * `if (hit) cache(hit)` is what anyone would write next. See the file header.
 */
export const MAPBOX_GEOCODES_ARE_TEMPORARY = true;

/**
 * Whether a Directions or Matrix result may be stored. It may not (Product
 * Terms §2.10.1). Same reason for a named constant as the one above.
 */
export const MAPBOX_NAVIGATION_IS_LIVE_ONLY = true;

export class MapboxApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'MapboxApiError';
  }
}

/** Raised when no token is registered at all — the caller's cue to fall back. */
export class MapboxNotConfiguredError extends MapboxApiError {
  constructor() {
    super(`No Mapbox API token. ${MAPBOX_API_KEY_HELP}`);
    this.name = 'MapboxNotConfiguredError';
  }
}

interface Auth {
  query: Record<string, string>;
  headers: Record<string, string>;
  /** Values to scrub from anything that might be logged or returned. */
  plaintexts: string[];
}

/**
 * Resolve the Mapbox API token.
 *
 * A missing registration falls through to the env var. Any OTHER registry error
 * — most likely a binding pointed at the wrong host, or one left read-only — is
 * surfaced rather than swallowed, because reporting "no token configured" when
 * the token is right there but mis-bound sends you looking in the wrong place.
 * That distinction was learned the expensive way on the openrouteservice key.
 */
async function mapboxAuth(url: string, method = 'GET'): Promise<Auth> {
  try {
    const { resolveSecretForUrl } = await import('$lib/secrets/registry');
    const resolved = await resolveSecretForUrl(MAPBOX_API_SECRET_HANDLE, url, method);
    return {
      query: resolved.query ?? {},
      headers: resolved.headers ?? {},
      plaintexts: resolved.plaintexts ?? [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/no secret registered under the handle/i.test(message)) {
      throw new MapboxApiError(`Mapbox credential rejected: ${message}`);
    }
  }

  const token = env[ENV_VAR];
  if (token) return { query: { access_token: token }, headers: {}, plaintexts: [token] };

  throw new MapboxNotConfiguredError();
}

/**
 * Whether a token exists at all.
 *
 * Callers check this before attempting Mapbox, because "no token" is the
 * ordinary state until the owner registers one and the alternative is a
 * database read plus a thrown-and-caught exception on EVERY lookup — twelve of
 * each for a twelve-place map, in front of the Nominatim path that was already
 * going to answer.
 *
 * A NEGATIVE answer is memoised briefly; a positive one is not. That asymmetry
 * is the point: the miss is the hot path worth avoiding, and capping it at a
 * minute means registering a token starts working on its own rather than
 * needing a restart. The window is short enough that nobody notices it, and the
 * real call still fails honestly if the token disappears inside it.
 */
const CONFIGURED_MISS_TTL_MS = 60_000;
let configuredMissUntil = 0;

export async function mapboxApiConfigured(): Promise<boolean> {
  if (env[ENV_VAR]) return true;
  if (Date.now() < configuredMissUntil) return false;
  try {
    const { getSecretMeta } = await import('$lib/secrets/registry');
    const meta = await getSecretMeta(MAPBOX_API_SECRET_HANDLE);
    const available = Boolean(meta?.available);
    if (!available) configuredMissUntil = Date.now() + CONFIGURED_MISS_TTL_MS;
    return available;
  } catch {
    // No registry on this host at all — the answer will not change in a minute.
    configuredMissUntil = Date.now() + CONFIGURED_MISS_TTL_MS;
    return false;
  }
}

/** Test seam: the memo above would otherwise leak between cases. */
export function resetMapboxConfiguredCache(): void {
  configuredMissUntil = 0;
}

const HTTP_TIMEOUT_MS = 10_000;

/** GET a Mapbox endpoint, with the token merged in and scrubbed from errors. */
async function mapboxGet(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  // Bind-check and resolve against the token-free URL; the credential is added
  // afterwards so it never appears in anything the registry logs.
  const auth = await mapboxAuth(url.toString());
  for (const [k, v] of Object.entries(auth.query)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', ...auth.headers },
      // Composed, not replaced: a caller passing a cancellation signal must not
      // silently inherit no timeout at all and hang for the platform default.
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)])
        : AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new MapboxApiError(`Mapbox request failed: ${scrub(message, auth.plaintexts)}`, undefined, true);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 429 is the per-minute ceiling or the monthly free tier running out; 5xx is
    // Mapbox being unwell. Both mean "try the other provider", not "give up".
    const retryable = res.status === 429 || res.status >= 500;
    throw new MapboxApiError(
      `Mapbox ${res.status}: ${scrub(text.slice(0, 300), auth.plaintexts)}`,
      res.status,
      retryable,
    );
  }

  return res.json();
}

/** Remove any token fragment from text on its way into an error or a log. */
function scrub(text: string, plaintexts: string[]): string {
  let out = text;
  for (const secret of plaintexts) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Search — https://api.mapbox.com/search/searchbox/v1
//
// See the header for why this is Search Box and not the Geocoding API: POIs.
// ---------------------------------------------------------------------------

export interface MapboxPlace {
  lat: number;
  lng: number;
  /** Mapbox's full address, so a wrong hit is visible rather than silent. */
  label: string;
  /** Just the thing's own name — "Norwich Cathedral", without the address tail. */
  name: string | null;
  /** `poi`, `address`, `street`, `place`, `region`, `postcode`, `country`. */
  featureType: string | null;
  /** Mapbox's POI categories, e.g. ["cafe", "coffee shop"]. Empty for an address. */
  poiCategories: string[];
  /** ISO 3166-1 alpha-2, when Mapbox resolved a country for the hit. */
  countryCode: string | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function joinNonEmpty(parts: Array<string | null>): string | null {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length ? kept.join(', ') : null;
}

/** Pull one Search Box feature into our shape. Null for anything malformed. */
function toPlace(feature: unknown): MapboxPlace | null {
  const f = feature as {
    properties?: {
      coordinates?: { longitude?: unknown; latitude?: unknown };
      full_address?: unknown;
      name_preferred?: unknown;
      name?: unknown;
      place_formatted?: unknown;
      feature_type?: unknown;
      poi_category?: unknown;
      context?: { country?: { country_code?: unknown } };
    };
    geometry?: { coordinates?: unknown[] };
  } | null;

  const props = f?.properties;
  if (!props) return null;

  // `properties.coordinates` is the documented home; `geometry` carries the same
  // pair and is the only one present on some feature types, so try both.
  const lng = Number(props.coordinates?.longitude ?? (f?.geometry?.coordinates ?? [])[0]);
  const lat = Number(props.coordinates?.latitude ?? (f?.geometry?.coordinates ?? [])[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const name = str(props.name_preferred) ?? str(props.name);
  const label = str(props.full_address) ?? joinNonEmpty([name, str(props.place_formatted)]);

  return {
    lat,
    lng,
    label: label ?? '',
    name,
    featureType: str(props.feature_type),
    poiCategories: Array.isArray(props.poi_category)
      ? props.poi_category.map(str).filter((c): c is string => c !== null)
      : [],
    countryCode: str(props.context?.country?.country_code)?.toUpperCase() ?? null,
  };
}

export interface ForwardSearchOptions {
  /** [lat, lng] to bias toward — the difference between the two Newcastles. */
  near?: [number, number];
  /** ISO 3166-1 alpha-2 codes to restrict to. */
  country?: string[];
  /** Feature types to restrict to, e.g. ['poi'] or ['address','street']. */
  types?: string[];
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Resolve a place NAME to coordinates — a POI, an address or a settlement.
 *
 * Returns candidates in Mapbox's own relevance order. Callers wanting one
 * answer take the first; `geocodePlace` does exactly that.
 */
export async function forwardGeocode(
  query: string,
  opts: ForwardSearchOptions = {},
): Promise<MapboxPlace[]> {
  const text = (query ?? '').trim();
  // Search Box caps `q` at 256 characters and 400s on a longer one.
  if (text.length < 2) return [];

  const params: Record<string, string> = {
    q: text.slice(0, 256),
    limit: String(Math.min(Math.max(opts.limit ?? 1, 1), 10)),
  };
  if (opts.near) params.proximity = `${opts.near[1]},${opts.near[0]}`;
  if (opts.country?.length) params.country = opts.country.join(',').toLowerCase();
  if (opts.types?.length) params.types = opts.types.join(',');

  const data = (await mapboxGet('/search/searchbox/v1/forward', params, opts.signal)) as {
    features?: unknown[];
  };
  const features = Array.isArray(data?.features) ? data.features : [];
  return features.map(toPlace).filter((p): p is MapboxPlace => p !== null);
}

// ---------------------------------------------------------------------------
// Navigation — directions and matrices (restored from d6ee4eea0^, 2026-10-13)
//
// LIVE-ONLY: see MAPBOX_NAVIGATION_IS_LIVE_ONLY. Never cache what these return.
// ---------------------------------------------------------------------------

/**
 * The travel modes we ask Mapbox for, mapped to its profiles. `drive` is the
 * traffic-aware profile deliberately: an ETA that ignores traffic is the wrong
 * answer to every question anyone asks with it.
 */
export const MAPBOX_PROFILES = {
  drive: 'mapbox/driving-traffic',
  drive_free_flow: 'mapbox/driving',
  walk: 'mapbox/walking',
  cycle: 'mapbox/cycling',
} as const;

export type MapboxMode = keyof typeof MAPBOX_PROFILES;

/** Mapbox caps a Directions or Matrix request at 25 coordinates (10 with traffic). */
export const MAX_WAYPOINTS = 25;
export const MAX_WAYPOINTS_WITH_TRAFFIC = 10;

export function maxWaypointsFor(mode: MapboxMode): number {
  return mode === 'drive' ? MAX_WAYPOINTS_WITH_TRAFFIC : MAX_WAYPOINTS;
}

export interface MapboxRoute {
  distanceM: number;
  durationS: number;
  /** Duration ignoring live traffic, when the profile reported one. */
  durationTypicalS: number | null;
  /** [lng, lat] pairs — GeoJSON order. */
  coordinates: [number, number][];
}

function num(v: unknown): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) ? n : null;
}

/**
 * Route through a run of waypoints in the order given. The order is the
 * caller's decision and Mapbox honours it exactly.
 */
export async function directions(opts: {
  mode: MapboxMode;
  /** [lng, lat] pairs, in visiting order. Two or more. */
  coordinates: [number, number][];
  signal?: AbortSignal;
}): Promise<MapboxRoute> {
  const profile = MAPBOX_PROFILES[opts.mode];
  if (!profile) throw new MapboxApiError(`Unknown travel mode "${opts.mode}"`);
  const coords = opts.coordinates ?? [];
  if (coords.length < 2) throw new MapboxApiError(`A route needs at least two waypoints; got ${coords.length}.`);
  const cap = maxWaypointsFor(opts.mode);
  if (coords.length > cap) throw new MapboxApiError(`Mapbox allows ${cap} waypoints for ${opts.mode}; got ${coords.length}.`);

  const path = `/directions/v5/${profile}/${coords.map((c) => `${c[0]},${c[1]}`).join(';')}`;
  const data = (await mapboxGet(path, { geometries: 'geojson', overview: 'full', steps: 'false' }, opts.signal)) as {
    code?: string;
    message?: string;
    routes?: Array<{ distance?: unknown; duration?: unknown; duration_typical?: unknown; geometry?: { coordinates?: unknown } }>;
  };
  if (data?.code && data.code !== 'Ok') {
    throw new MapboxApiError(`Mapbox directions: ${data.code}${data.message ? ` — ${data.message}` : ''}`);
  }
  const r = Array.isArray(data?.routes) ? data.routes[0] : null;
  const geometry = r?.geometry?.coordinates;
  if (!r || !Array.isArray(geometry) || !geometry.length) throw new MapboxApiError('Mapbox returned no route');
  return {
    distanceM: num(r.distance) ?? 0,
    durationS: num(r.duration) ?? 0,
    durationTypicalS: num(r.duration_typical),
    coordinates: geometry as [number, number][],
  };
}

export interface MapboxMatrix {
  /** durations[i][j] — seconds from sources[i] to destinations[j], null if unreachable. */
  durations: (number | null)[][];
  /** distances[i][j] — metres, when distance was asked for. */
  distances: (number | null)[][] | null;
}

/**
 * Travel time (and optionally distance) from every source to every destination
 * in one request. Each cell is an element against the monthly allowance.
 */
export async function matrix(opts: {
  mode: MapboxMode;
  /** [lng, lat] pairs. */
  coordinates: [number, number][];
  /** Indices into `coordinates`. Omit for "every point to every point". */
  sources?: number[];
  destinations?: number[];
  includeDistance?: boolean;
  signal?: AbortSignal;
}): Promise<MapboxMatrix> {
  const profile = MAPBOX_PROFILES[opts.mode];
  if (!profile) throw new MapboxApiError(`Unknown travel mode "${opts.mode}"`);
  const coords = opts.coordinates ?? [];
  const cap = maxWaypointsFor(opts.mode);
  if (coords.length < 2) throw new MapboxApiError(`A matrix needs at least two points; got ${coords.length}.`);
  if (coords.length > cap) throw new MapboxApiError(`Mapbox allows ${cap} points for ${opts.mode}; got ${coords.length}.`);
  // Mapbox does not serve `distance` on the traffic profile and refuses the
  // whole request rather than returning durations alone.
  if (opts.includeDistance && opts.mode === 'drive') {
    throw new MapboxApiError('Mapbox cannot return distances on the live-traffic profile.');
  }

  const path = `/directions-matrix/v1/${profile}/${coords.map((c) => `${c[0]},${c[1]}`).join(';')}`;
  const params: Record<string, string> = { annotations: opts.includeDistance ? 'duration,distance' : 'duration' };
  if (opts.sources?.length) params.sources = opts.sources.join(';');
  if (opts.destinations?.length) params.destinations = opts.destinations.join(';');

  const data = (await mapboxGet(path, params, opts.signal)) as {
    code?: string;
    message?: string;
    durations?: unknown;
    distances?: unknown;
  };
  if (data?.code && data.code !== 'Ok') {
    throw new MapboxApiError(`Mapbox matrix: ${data.code}${data.message ? ` — ${data.message}` : ''}`);
  }
  if (!Array.isArray(data?.durations)) throw new MapboxApiError('Mapbox matrix returned no durations');
  return {
    durations: data.durations as (number | null)[][],
    distances: Array.isArray(data?.distances) ? (data.distances as (number | null)[][]) : null,
  };
}
