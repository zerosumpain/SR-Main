// src/lib/maps/mapbox-api.ts
//
// Mapbox's server-side APIs — geocoding, directions, isochrones and travel-time
// matrices — behind one client, so the site stops paying the Nominatim tax for
// work an account we already hold does better and faster.
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
// crosses to a browser. `$lib/maps/config.server` is untouched.
//
// The registry is the precedent, not an invention: `$lib/trails/ors.ts` holds
// the openrouteservice key exactly this way, down to the env-var fallback for
// homeserv, which sets API_REGISTRY_DISABLED=1 and holds no registry at all.
//
// THE FREE TIER, MEASURED (September 2026, mapbox.com/pricing):
//
//   Search Box (fwd/rev)    50,000 req/month     600 req/min
//   Directions             100,000 req/month     300 req/min
//   Isochrone              100,000 req/month     300 req/min
//   Matrix                 100,000 elements/mo    60 req/min (30 w/ traffic)
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
// the geocoder rather than shadowing it. `/forward` and `/reverse` are the
// per-request endpoints and need no session token; `/suggest` + `/retrieve` are
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
// So every Mapbox result carries `source: 'mapbox'`, and the callers in
// `$lib/workflows/site-tools/geocode` and `$lib/daydream/geocode` refuse to
// persist one. Nominatim's results stay cacheable — its policy actively asks
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
 * That distinction is lifted straight from `orsAuthHeaders`; it was learned the
 * expensive way there.
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

/**
 * What is at this point?
 *
 * The inverse of `forwardGeocode`, same shape out. Answers with the POI when
 * there is one — which is the whole reason the daydream place-namer wants this
 * route: "Costa Coffee" is a useful suggestion for a spot you sat in, and
 * "12 High Street" is not.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  opts: { types?: string[]; limit?: number; signal?: AbortSignal } = {},
): Promise<MapboxPlace | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const params: Record<string, string> = {
    longitude: String(lng),
    latitude: String(lat),
    limit: String(Math.min(Math.max(opts.limit ?? 1, 1), 10)),
  };
  if (opts.types?.length) params.types = opts.types.join(',');

  const data = (await mapboxGet('/search/searchbox/v1/reverse', params, opts.signal)) as {
    features?: unknown[];
  };
  const features = Array.isArray(data?.features) ? data.features : [];
  for (const feature of features) {
    const place = toPlace(feature);
    if (place) return place;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Navigation — directions, isochrones, matrices
// ---------------------------------------------------------------------------

/**
 * The travel modes we expose, mapped to Mapbox profiles.
 *
 * `drive` is the traffic-aware profile deliberately: an ETA that ignores
 * traffic is the wrong answer to every question anyone actually asks with it.
 * `drive_free_flow` is there for the times you want the road's own speed —
 * planning a 3am journey, or comparing two routes without today's jam in the
 * numbers.
 */
export const MAPBOX_PROFILES = {
  drive: 'mapbox/driving-traffic',
  drive_free_flow: 'mapbox/driving',
  walk: 'mapbox/walking',
  cycle: 'mapbox/cycling',
} as const;

export type TravelMode = keyof typeof MAPBOX_PROFILES;

export const TRAVEL_MODES = Object.keys(MAPBOX_PROFILES) as TravelMode[];

/** Mapbox caps a Directions or Matrix request at 25 coordinates (10 with traffic). */
export const MAX_WAYPOINTS = 25;
export const MAX_WAYPOINTS_WITH_TRAFFIC = 10;

export function maxWaypointsFor(mode: TravelMode): number {
  return mode === 'drive' ? MAX_WAYPOINTS_WITH_TRAFFIC : MAX_WAYPOINTS;
}

/** Time-of-day routing means nothing without a traffic model. */
const SUPPORTS_DEPART_AT = new Set<TravelMode>(['drive', 'drive_free_flow']);

/**
 * Road types a profile will actually accept in `exclude`.
 *
 * Motorways and tolls are meaningless on foot — you were never routed onto one
 * — and Mapbox rejects the whole request rather than ignoring the parameter, so
 * "a 20-minute walk avoiding unpaved paths" 422s instead of answering. A ferry
 * is the one exclusion that means something in every mode.
 */
const EXCLUSIONS_BY_MODE: Record<TravelMode, ReadonlySet<string>> = {
  drive: new Set(['motorway', 'toll', 'ferry', 'unpaved', 'cash_only_tolls']),
  drive_free_flow: new Set(['motorway', 'toll', 'ferry', 'unpaved', 'cash_only_tolls']),
  walk: new Set(['ferry']),
  cycle: new Set(['ferry']),
};

export function allowedExclusions(mode: TravelMode, wanted?: string[]): string[] {
  const allowed = EXCLUSIONS_BY_MODE[mode] ?? new Set<string>();
  return (wanted ?? []).filter((x) => allowed.has(x));
}

export interface RouteStep {
  instruction: string;
  distanceM: number;
  durationS: number;
  name: string | null;
}

export interface RouteLeg {
  distanceM: number;
  durationS: number;
  summary: string | null;
  steps: RouteStep[];
}

export interface MapboxRoute {
  distanceM: number;
  durationS: number;
  /** Duration ignoring live traffic, when the profile reported one. */
  durationTypicalS: number | null;
  /** [lng, lat] pairs — GeoJSON order, matching what ORS returns. */
  coordinates: [number, number][];
  legs: RouteLeg[];
  weightName: string | null;
}

export interface DirectionsOptions {
  mode: TravelMode;
  /** [lng, lat] pairs, in visiting order. Two or more. */
  coordinates: [number, number][];
  /** Turn-by-turn guidance. Off by default — it is verbose and rarely wanted. */
  steps?: boolean;
  /** Ask for up to two meaningfully different routes as well as the best one. */
  alternatives?: boolean;
  /** Road types to keep out of the route: motorway, toll, ferry, unpaved… */
  exclude?: string[];
  /** ISO 8601 local departure time, for time-of-day traffic. */
  departAt?: string;
  signal?: AbortSignal;
}

/**
 * Route through a run of waypoints in the order given.
 *
 * The order is the caller's decision and Mapbox honours it exactly — the same
 * contract `viaRoute` has in the ORS client, and for the same reason: a journey
 * that must touch three places in sequence is not the same journey as one that
 * visits them in whatever order is quickest.
 */
export async function directions(opts: DirectionsOptions): Promise<MapboxRoute[]> {
  const profile = MAPBOX_PROFILES[opts.mode];
  if (!profile) throw new MapboxApiError(`Unknown travel mode "${opts.mode}"`);

  const coords = opts.coordinates ?? [];
  if (coords.length < 2) {
    throw new MapboxApiError(`A route needs at least two waypoints; got ${coords.length}.`);
  }
  const cap = maxWaypointsFor(opts.mode);
  if (coords.length > cap) {
    throw new MapboxApiError(
      `Mapbox allows ${cap} waypoints for ${opts.mode}; got ${coords.length}.`,
    );
  }

  const path = `/directions/v5/${profile}/${coords.map((c) => `${c[0]},${c[1]}`).join(';')}`;
  const params: Record<string, string> = {
    geometries: 'geojson',
    overview: 'full',
    steps: opts.steps ? 'true' : 'false',
    // `duration_typical` only appears on the traffic profile, and it is what
    // turns "47 minutes" into "47 minutes, 12 more than usual".
    annotations: opts.mode === 'drive' ? 'duration,distance,congestion' : 'duration,distance',
  };
  if (opts.alternatives) params.alternatives = 'true';
  // `exclude` and `depart_at` are not accepted on every profile, and Mapbox
  // answers an unsupported one with a 422 whose message says nothing about the
  // profile. Filtering here turns "avoid unpaved paths on a walk" into a route
  // that simply ignores an inapplicable preference, rather than an API error.
  const exclude = allowedExclusions(opts.mode, opts.exclude);
  if (exclude.length) params.exclude = exclude.join(',');
  if (opts.departAt && SUPPORTS_DEPART_AT.has(opts.mode)) params.depart_at = opts.departAt;

  const data = (await mapboxGet(path, params, opts.signal)) as {
    code?: string;
    message?: string;
    routes?: unknown[];
  };

  if (data?.code && data.code !== 'Ok') {
    throw new MapboxApiError(`Mapbox directions: ${data.code}${data.message ? ` — ${data.message}` : ''}`);
  }

  const routes = Array.isArray(data?.routes) ? data.routes : [];
  if (!routes.length) throw new MapboxApiError('Mapbox returned no route');

  return routes.map(toRoute).filter((r): r is MapboxRoute => r !== null);
}

function toRoute(raw: unknown): MapboxRoute | null {
  const r = raw as {
    distance?: unknown;
    duration?: unknown;
    duration_typical?: unknown;
    weight_name?: unknown;
    geometry?: { coordinates?: unknown };
    legs?: unknown[];
  } | null;
  const geometry = r?.geometry?.coordinates;
  if (!Array.isArray(geometry) || !geometry.length) return null;

  const legs = Array.isArray(r?.legs) ? r.legs : [];
  return {
    distanceM: num(r?.distance) ?? 0,
    durationS: num(r?.duration) ?? 0,
    durationTypicalS: num(r?.duration_typical),
    coordinates: geometry as [number, number][],
    weightName: str(r?.weight_name),
    legs: legs.map((leg) => {
      const l = leg as { distance?: unknown; duration?: unknown; summary?: unknown; steps?: unknown[] };
      const steps = Array.isArray(l?.steps) ? l.steps : [];
      return {
        distanceM: num(l?.distance) ?? 0,
        durationS: num(l?.duration) ?? 0,
        summary: str(l?.summary),
        steps: steps.map((step) => {
          const s = step as {
            distance?: unknown;
            duration?: unknown;
            name?: unknown;
            maneuver?: { instruction?: unknown };
          };
          return {
            instruction: str(s?.maneuver?.instruction) ?? '',
            distanceM: num(s?.distance) ?? 0,
            durationS: num(s?.duration) ?? 0,
            name: str(s?.name),
          };
        }),
      };
    }),
  };
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Mapbox caps an isochrone at four contours, 60 minutes or 100 km. */
export const MAX_CONTOURS = 4;
export const MAX_CONTOUR_MINUTES = 60;
export const MAX_CONTOUR_METRES = 100_000;

export interface IsochroneContour {
  /** Minutes or metres, matching what was asked for. */
  value: number;
  unit: 'minutes' | 'metres';
  /** Ring of [lng, lat] pairs bounding what is reachable within `value`. */
  polygon: [number, number][];
  /** Rough area of the ring, km². Useful as "how much ground is that". */
  areaKm2: number;
}

/**
 * How far can you get from here in N minutes?
 *
 * The question behind "where could we meet", "is that within a half-hour drive"
 * and "what is inside a twenty-minute walk of the hotel" — none of which a
 * directions call answers, because they are about an AREA rather than a line.
 */
export async function isochrone(opts: {
  mode: TravelMode;
  /** [lng, lat] centre. */
  centre: [number, number];
  /** Up to four values. Minutes unless `unit` says metres. */
  contours: number[];
  unit?: 'minutes' | 'metres';
  exclude?: string[];
  departAt?: string;
  signal?: AbortSignal;
}): Promise<IsochroneContour[]> {
  const profile = MAPBOX_PROFILES[opts.mode];
  if (!profile) throw new MapboxApiError(`Unknown travel mode "${opts.mode}"`);

  const unit = opts.unit ?? 'minutes';
  const max = unit === 'minutes' ? MAX_CONTOUR_MINUTES : MAX_CONTOUR_METRES;
  const values = (opts.contours ?? [])
    .map((v) => Math.round(Number(v)))
    .filter((v) => Number.isFinite(v) && v >= 1 && v <= max)
    // Mapbox requires them in ascending order and rejects the request otherwise.
    .sort((a, b) => a - b)
    .slice(0, MAX_CONTOURS);

  if (!values.length) {
    throw new MapboxApiError(
      `contours must hold 1–${MAX_CONTOURS} values between 1 and ${max} ${unit}`,
    );
  }

  const path = `/isochrone/v1/${profile}/${opts.centre[0]},${opts.centre[1]}`;
  const params: Record<string, string> = {
    polygons: 'true',
    [unit === 'minutes' ? 'contours_minutes' : 'contours_meters']: values.join(','),
  };
  const exclude = allowedExclusions(opts.mode, opts.exclude);
  if (exclude.length) params.exclude = exclude.join(',');
  if (opts.departAt && SUPPORTS_DEPART_AT.has(opts.mode)) params.depart_at = opts.departAt;

  const data = (await mapboxGet(path, params, opts.signal)) as { features?: unknown[] };
  const features = Array.isArray(data?.features) ? data.features : [];

  return features
    .map((feature) => {
      const f = feature as {
        properties?: { contour?: unknown };
        geometry?: { coordinates?: unknown };
      };
      // A polygon's coordinates are an array of rings; the first is the outer.
      const rings = f?.geometry?.coordinates;
      const ring = Array.isArray(rings) ? rings[0] : null;
      const value = num(f?.properties?.contour);
      if (!Array.isArray(ring) || !ring.length || value == null) return null;
      const polygon = ring as [number, number][];
      return { value, unit, polygon, areaKm2: ringAreaKm2(polygon) };
    })
    .filter((c): c is IsochroneContour => c !== null)
    .sort((a, b) => a.value - b.value);
}

/**
 * Area of a lat/lng ring in km², by the shoelace formula on a local projection.
 *
 * Good enough for "that is about 40 km²" and nothing finer — longitude is
 * scaled by the cosine of the ring's mean latitude, which is accurate for the
 * tens of kilometres an isochrone spans and increasingly wrong beyond that.
 */
function ringAreaKm2(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const meanLat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((meanLat * Math.PI) / 180);

  let twiceArea = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    twiceArea += x1 * kmPerDegLng * (y2 * kmPerDegLat) - x2 * kmPerDegLng * (y1 * kmPerDegLat);
  }
  return Math.abs(twiceArea / 2);
}

export interface TravelMatrix {
  /** durations[i][j] — seconds from sources[i] to destinations[j], null if unreachable. */
  durations: (number | null)[][];
  /** distances[i][j] — metres, when distance was asked for. */
  distances: (number | null)[][] | null;
}

/**
 * Travel time (and optionally distance) from every source to every destination.
 *
 * One request rather than N×M directions calls, which is the whole point: "of
 * these six pubs, which is closest to all four of us" is 24 routes the slow way
 * and one matrix the right way. Mapbox counts each cell as an element against
 * the 100,000/month free allowance, so a 6×4 is 24 elements, not 1.
 */
export async function matrix(opts: {
  mode: TravelMode;
  /** [lng, lat] pairs. Sources first, then destinations. */
  coordinates: [number, number][];
  /** Indices into `coordinates`. Omit for "every point to every point". */
  sources?: number[];
  destinations?: number[];
  includeDistance?: boolean;
  signal?: AbortSignal;
}): Promise<TravelMatrix> {
  const profile = MAPBOX_PROFILES[opts.mode];
  if (!profile) throw new MapboxApiError(`Unknown travel mode "${opts.mode}"`);

  const coords = opts.coordinates ?? [];
  const cap = maxWaypointsFor(opts.mode);
  if (coords.length < 2) {
    throw new MapboxApiError(`A matrix needs at least two points; got ${coords.length}.`);
  }
  if (coords.length > cap) {
    throw new MapboxApiError(`Mapbox allows ${cap} points for ${opts.mode}; got ${coords.length}.`);
  }

  // Mapbox does not serve the `distance` annotation on the traffic profile, and
  // refuses the whole request rather than returning durations alone. Saying so
  // beats silently swapping the profile: the answer would then quietly stop
  // accounting for traffic, which is the only reason to have asked for `drive`.
  if (opts.includeDistance && opts.mode === 'drive') {
    throw new MapboxApiError(
      'Mapbox cannot return distances on the live-traffic profile. Use mode "drive_free_flow" for ' +
        'distances, or drop includeDistance to keep traffic-aware times.',
    );
  }

  const path = `/directions-matrix/v1/${profile}/${coords.map((c) => `${c[0]},${c[1]}`).join(';')}`;
  const params: Record<string, string> = {
    annotations: opts.includeDistance ? 'duration,distance' : 'duration',
  };
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
