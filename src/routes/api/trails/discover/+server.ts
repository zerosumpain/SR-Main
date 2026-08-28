import { json } from '@sveltejs/kit';
import {
  fetchSharedRouteGeometry,
  lineDistanceM,
  searchSharedRoutes,
} from '$lib/trails/discover';
import { gradeDifficulty } from '$lib/trails/difficulty';
import { profileFit } from '$lib/trails/scoring';
import { elevationLine, orsConfigured, ORS_PROFILES, type PlannerSport } from '$lib/trails/ors';
import type { RequestHandler } from './$types';

// Owner-gated by hooks.server.ts, like the rest of /api/trails.

/**
 * Two asks on one endpoint, split by parameter:
 *  ?lat=&lng=&sport=       → shared OSM routes near a point (metadata only)
 *  ?osmId=&sport=          → one route's stitched geometry, elevation-enriched
 *                            when ORS is configured, with a difficulty grade
 */
export const GET: RequestHandler = async ({ url }) => {
  const sport = url.searchParams.get('sport') ?? 'run';
  if (!(sport in ORS_PROFILES)) return json({ error: 'unknown sport' }, { status: 400 });

  const osmIdRaw = url.searchParams.get('osmId');
  if (osmIdRaw) {
    const osmId = Number(osmIdRaw);
    if (!Number.isInteger(osmId) || osmId <= 0) {
      return json({ error: 'osmId must be a positive integer' }, { status: 400 });
    }
    return detail(osmId, sport as PlannerSport);
  }

  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ error: 'lat and lng are required' }, { status: 400 });
  }

  try {
    return json({ routes: await searchSharedRoutes(lat, lng, sport as PlannerSport) });
  } catch (err) {
    console.warn('[trails/discover] search failed:', (err as Error)?.message);
    return json(
      { error: 'Overpass did not answer — shared routes are unavailable right now.' },
      { status: 502 },
    );
  }
};

async function detail(osmId: number, sport: PlannerSport) {
  let name: string;
  let coordinates: [number, number][] | [number, number, number][];
  try {
    ({ name, coordinates } = await fetchSharedRouteGeometry(osmId));
  } catch (err) {
    console.warn('[trails/discover] geometry failed:', (err as Error)?.message);
    return json(
      { error: 'Could not fetch that route’s geometry from OpenStreetMap.' },
      { status: 502 },
    );
  }

  const distanceM = Math.round(lineDistanceM(coordinates as [number, number][]));

  // Elevation is an enrichment, not a requirement: without a key (or when the
  // elevation API is down) the difficulty is honestly graded on distance alone.
  let ascentM: number | null = null;
  if (await orsConfigured()) {
    try {
      coordinates = await elevationLine(coordinates as [number, number][]);
      const fit = profileFit(coordinates);
      ascentM = Math.round(fit.gainPerKm * (distanceM / 1000));
    } catch (err) {
      console.warn('[trails/discover] elevation enrich failed:', (err as Error)?.message);
    }
  }

  return json({
    osmId,
    name,
    coordinates,
    distanceM,
    ascentM,
    difficulty: gradeDifficulty({ distanceM, ascentM, sport }),
  });
}
