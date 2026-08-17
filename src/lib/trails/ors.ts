// openrouteservice client.
//
// ORS is a candidate GENERATOR, not the ranker. Its round_trip will happily
// return a route that pads distance by running down a lane and turning back;
// deciding whether that is acceptable is `scoring.ts`'s job, not this file's.

import { env } from '$env/dynamic/private';

const BASE = 'https://api.openrouteservice.org';

/** ORS profiles we expose. Each maps to one of John's sports. */
export const ORS_PROFILES = {
  run: 'foot-hiking',
  trail_run: 'foot-hiking',
  walk: 'foot-walking',
  hike: 'foot-hiking',
  ride: 'cycling-road',
  mtb: 'cycling-mountain',
} as const;

export type PlannerSport = keyof typeof ORS_PROFILES;

/** Round-trip and alternative routes are capped by ORS at 100 km. */
export const ORS_ROUND_TRIP_MAX_M = 100_000;

export class OrsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}

/** The handle the owner registers the key under at /admin/ai/apis. */
export const ORS_SECRET_HANDLE = 'openrouteservice';

export const ORS_KEY_HELP =
  `Add the key at /admin/ai/apis under the handle "${ORS_SECRET_HANDLE}" — ` +
  'injection: header "Authorization", host: api.openrouteservice.org, and allow POST ' +
  '(an empty method list means read-only, and directions is a POST). ' +
  'A free key comes from openrouteservice.org/dev.';

/**
 * Resolve the ORS credential.
 *
 * The registry is the real home for it: the value stays encrypted, bound by the
 * owner to one host, and jkai can use it without being able to read it. The
 * `ORS_API_KEY` env var remains as a fallback because the registry is
 * production-only — homeserv sets `API_REGISTRY_DISABLED=1` and holds no
 * registry at all, so local development would otherwise have no way to plan.
 *
 * A missing registration falls through to the env var. Any OTHER registry
 * error — most likely a binding that forbids POST or the wrong host — is
 * surfaced, because reporting "no key configured" when the key is right there
 * but mis-bound sends you looking in the wrong place entirely.
 */
async function orsAuthHeaders(url: string, method: string): Promise<Record<string, string>> {
  try {
    const { resolveSecretForUrl } = await import('$lib/secrets/registry');
    const resolved = await resolveSecretForUrl(ORS_SECRET_HANDLE, url, method);
    return resolved.headers;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const notRegistered = /no secret registered under the handle/i.test(message);
    if (!notRegistered) {
      throw new OrsError(`openrouteservice credential rejected: ${message}`);
    }
  }

  if (env.ORS_API_KEY) return { Authorization: env.ORS_API_KEY };

  throw new OrsError(`No openrouteservice credential. ${ORS_KEY_HELP}`);
}

/**
 * Whether a credential exists at all — used to decide if the planner UI should
 * offer the button or explain why it cannot.
 */
export async function orsConfigured(): Promise<boolean> {
  if (env.ORS_API_KEY) return true;
  try {
    const { getSecretMeta } = await import('$lib/secrets/registry');
    const meta = await getSecretMeta(ORS_SECRET_HANDLE);
    return Boolean(meta?.available);
  } catch {
    return false;
  }
}

export interface OrsExtraSummary {
  value: number;
  distance: number;
  amount: number;
}

export interface OrsRoute {
  /** [lng, lat, elevation] triples. */
  coordinates: [number, number, number?][];
  distanceM: number;
  durationS: number;
  ascentM: number | null;
  descentM: number | null;
  surface: OrsExtraSummary[];
  waytype: OrsExtraSummary[];
  steepness: OrsExtraSummary[];
}

interface DirectionsOptions {
  profile: string;
  coordinates: [number, number][];
  roundTrip?: { lengthM: number; points: number; seed: number };
  avoidFeatures?: string[];
  signal?: AbortSignal;
}

async function directions(opts: DirectionsOptions): Promise<OrsRoute> {
  const url = `${BASE}/v2/directions/${opts.profile}/geojson`;
  const auth = await orsAuthHeaders(url, 'POST');

  const body: Record<string, unknown> = {
    coordinates: opts.coordinates,
    elevation: true,
    extra_info: ['surface', 'waytype', 'steepness'],
    instructions: false,
  };

  const options: Record<string, unknown> = {};
  if (opts.roundTrip) {
    options.round_trip = {
      length: opts.roundTrip.lengthM,
      points: opts.roundTrip.points,
      seed: opts.roundTrip.seed,
    };
  }
  if (opts.avoidFeatures?.length) options.avoid_features = opts.avoidFeatures;
  if (Object.keys(options).length) body.options = options;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'application/json',
      Accept: 'application/geo+json',
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 429 is the free tier's daily/minute ceiling; 503 is ORS being busy.
    // Both are worth retrying later, so callers can fall back to cache
    // rather than surfacing a dead end.
    const retryable = res.status === 429 || res.status === 503;
    throw new OrsError(`ORS ${res.status}: ${text.slice(0, 300)}`, res.status, retryable);
  }

  const data = await res.json();
  const feature = data?.features?.[0];
  if (!feature?.geometry?.coordinates?.length) {
    throw new OrsError('ORS returned no route geometry');
  }

  const props = feature.properties ?? {};
  const extras = props.extras ?? {};

  return {
    coordinates: feature.geometry.coordinates,
    distanceM: props.summary?.distance ?? 0,
    durationS: props.summary?.duration ?? 0,
    ascentM: typeof props.ascent === 'number' ? props.ascent : null,
    descentM: typeof props.descent === 'number' ? props.descent : null,
    surface: extras.surface?.summary ?? [],
    waytype: extras.waytype?.summary ?? [],
    steepness: extras.steepness?.summary ?? [],
  };
}

/**
 * Ask ORS for one circular route.
 *
 * `seed` is the only thing that varies between candidates — ORS uses it to
 * pick a different bearing out of the start point, so N seeds give N genuinely
 * different loops rather than N variations on one.
 */
export function roundTrip(args: {
  profile: string;
  start: [number, number];
  lengthM: number;
  seed: number;
  points?: number;
  avoidFeatures?: string[];
  signal?: AbortSignal;
}): Promise<OrsRoute> {
  if (args.lengthM > ORS_ROUND_TRIP_MAX_M) {
    throw new OrsError(
      `Round trips are capped at ${ORS_ROUND_TRIP_MAX_M / 1000} km by openrouteservice; asked for ${Math.round(args.lengthM / 1000)} km`,
    );
  }
  return directions({
    profile: args.profile,
    coordinates: [args.start],
    roundTrip: { lengthM: args.lengthM, points: args.points ?? 5, seed: args.seed },
    avoidFeatures: args.avoidFeatures,
    signal: args.signal,
  });
}

export function pointToPoint(args: {
  profile: string;
  waypoints: [number, number][];
  avoidFeatures?: string[];
  signal?: AbortSignal;
}): Promise<OrsRoute> {
  return directions({
    profile: args.profile,
    coordinates: args.waypoints,
    avoidFeatures: args.avoidFeatures,
    signal: args.signal,
  });
}
