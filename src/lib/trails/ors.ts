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

export function orsConfigured(): boolean {
  return Boolean(env.ORS_API_KEY);
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
  const key = env.ORS_API_KEY;
  if (!key) {
    throw new OrsError(
      'ORS_API_KEY is not set — get a free key at openrouteservice.org/dev and add it to the environment',
    );
  }

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

  const res = await fetch(`${BASE}/v2/directions/${opts.profile}/geojson`, {
    method: 'POST',
    headers: {
      Authorization: key,
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
