// The planner: generate candidates with ORS, rank them with our scorer, and
// let the health data set the target when the caller has not.
//
// The ranking is the product. ORS will return a "10 km loop" that spends 800 m
// running down a lane and back; this module is what notices and puts it last.

import { desc, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { activities } from '$lib/db/schema';
import { getReadiness } from '$lib/health/readiness-service';
import { getTrainingLoad } from '$lib/health/training-load-service';
import {
  ORS_PROFILES,
  ORS_ROUND_TRIP_MAX_M,
  OrsError,
  orsConfigured,
  pointToPoint,
  roundTrip,
  type OrsRoute,
  type PlannerSport,
} from './ors';
import { scoreRoute, type Coord, type RouteScore } from './scoring';

export interface PlanRequest {
  start: [number, number]; // [lng, lat]
  /** Omit for a circular route; supply to route between points. */
  finish?: [number, number];
  sport: PlannerSport;
  /** Target distance in metres. Omitted means "ask the health data". */
  targetDistanceM?: number;
  targetGainPerKm?: number;
  prefer?: 'steady' | 'spiky' | 'any';
  allowOutAndBack?: boolean;
  avoidFeatures?: string[];
  /** How many seeds to try. More seeds, better odds of a clean loop. */
  candidates?: number;
}

export interface PlannedRoute {
  rank: number;
  score: number;
  breakdown: RouteScore;
  distanceM: number;
  durationS: number;
  ascentM: number | null;
  descentM: number | null;
  coordinates: Coord[];
  seed: number | null;
}

export interface PlanResult {
  routes: PlannedRoute[];
  targetDistanceM: number;
  targetSource: 'requested' | 'training-load' | 'default';
  rationale: string[];
  attempted: number;
  failures: string[];
}

/**
 * Pick a sensible distance from what the body has actually been doing.
 *
 * Median of the last 8 weeks of this sport, nudged by the ACWR zone: a ratio
 * already in the caution band gets a shorter suggestion, a detraining one gets
 * room to grow. Falls back to a plain default when there is no history — which
 * is the normal state until the workout webhook has been running a while.
 */
export async function suggestTarget(sport: string): Promise<{
  distanceM: number;
  source: PlanResult['targetSource'];
  rationale: string[];
}> {
  const rationale: string[] = [];
  const DEFAULTS: Record<string, number> = {
    run: 8000,
    trail_run: 10_000,
    walk: 6000,
    hike: 12_000,
    ride: 30_000,
    mtb: 20_000,
  };

  let median: number | null = null;
  try {
    const since = Math.floor(Date.now() / 1000) - 56 * 86400;
    const [row] = await db
      .select({
        median: sql<number | null>`percentile_cont(0.5) within group (order by ${activities.distanceM})`,
      })
      .from(activities)
      .where(
        sql`${activities.activityType} = ${sport} and ${activities.startDate} >= ${since} and ${activities.distanceM} is not null`,
      );
    if (row?.median && row.median > 500) median = row.median;
  } catch (err) {
    console.warn('[trails/planner] median distance lookup failed:', (err as Error)?.message);
  }

  if (median == null) {
    rationale.push(
      `No recent ${sport} history, so the target is the default ${Math.round((DEFAULTS[sport] ?? 8000) / 1000)} km.`,
    );
    return { distanceM: DEFAULTS[sport] ?? 8000, source: 'default', rationale };
  }

  rationale.push(`Typical recent ${sport}: ${(median / 1000).toFixed(1)} km.`);

  let factor = 1;
  try {
    const load = await getTrainingLoad();
    if (load.zone === 'danger' || load.zone === 'caution') {
      factor = 0.8;
      rationale.push(
        `Training load is in the ${load.zone} band (ACWR ${load.ratio.toFixed(2)}), so the target is pulled back 20%.`,
      );
    } else if (load.zone === 'detraining') {
      factor = 1.15;
      rationale.push('Load has been light, so there is room for a slightly longer one.');
    }
  } catch {
    // Load is advisory. A dead analytic must not stop a route being planned.
  }

  try {
    const readiness = await getReadiness();
    if (readiness.score < 40) {
      factor *= 0.85;
      rationale.push(`Readiness is ${Math.round(readiness.score)} — keeping it shorter.`);
    }
  } catch {
    /* advisory */
  }

  return { distanceM: Math.round(median * factor), source: 'training-load', rationale };
}

function toCoords(route: OrsRoute): Coord[] {
  return route.coordinates as Coord[];
}

export async function planRoutes(req: PlanRequest): Promise<PlanResult> {
  if (!orsConfigured()) {
    throw new OrsError(
      'Route planning needs ORS_API_KEY. Get a free key at openrouteservice.org/dev and add it to the environment.',
    );
  }

  const profile = ORS_PROFILES[req.sport];
  if (!profile) throw new OrsError(`Unsupported sport: ${req.sport}`);

  let targetDistanceM = req.targetDistanceM ?? 0;
  let targetSource: PlanResult['targetSource'] = 'requested';
  const rationale: string[] = [];

  if (!targetDistanceM) {
    const suggested = await suggestTarget(req.sport);
    targetDistanceM = suggested.distanceM;
    targetSource = suggested.source;
    rationale.push(...suggested.rationale);
  }

  const circular = !req.finish;

  if (circular && targetDistanceM > ORS_ROUND_TRIP_MAX_M) {
    throw new OrsError(
      `Circular routes are capped at ${ORS_ROUND_TRIP_MAX_M / 1000} km by openrouteservice; asked for ${Math.round(targetDistanceM / 1000)} km. Plan it as a point-to-point instead.`,
    );
  }

  const failures: string[] = [];
  const scored: PlannedRoute[] = [];

  if (circular) {
    // Each seed sends ORS out on a different bearing, so the candidates are
    // genuinely different loops rather than variations on one. Requested
    // sequentially: the free tier allows 40 requests a minute and a burst of
    // parallel calls is the fastest way to lose the whole batch to a 429.
    const seedCount = Math.min(8, Math.max(2, req.candidates ?? 5));
    for (let i = 0; i < seedCount; i++) {
      const seed = i + 1;
      try {
        const route = await roundTrip({
          profile,
          start: req.start,
          lengthM: targetDistanceM,
          seed,
          avoidFeatures: req.avoidFeatures,
        });
        const coordinates = toCoords(route);
        scored.push({
          rank: 0,
          score: 0,
          seed,
          distanceM: route.distanceM,
          durationS: route.durationS,
          ascentM: route.ascentM,
          descentM: route.descentM,
          coordinates,
          breakdown: scoreRoute({
            coordinates,
            distanceM: route.distanceM,
            sport: req.sport,
            targetDistanceM,
            targetGainPerKm: req.targetGainPerKm,
            prefer: req.prefer,
            surface: route.surface,
            waytype: route.waytype,
            allowOutAndBack: req.allowOutAndBack,
          }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`seed ${seed}: ${message}`);
        // A rate limit will hit every remaining seed too — stop asking.
        if (err instanceof OrsError && err.status === 429) break;
      }
    }
  } else {
    try {
      const route = await pointToPoint({
        profile,
        waypoints: [req.start, req.finish!],
        avoidFeatures: req.avoidFeatures,
      });
      const coordinates = toCoords(route);
      scored.push({
        rank: 0,
        score: 0,
        seed: null,
        distanceM: route.distanceM,
        durationS: route.durationS,
        ascentM: route.ascentM,
        descentM: route.descentM,
        coordinates,
        breakdown: scoreRoute({
          coordinates,
          distanceM: route.distanceM,
          sport: req.sport,
          targetDistanceM: targetDistanceM || route.distanceM,
          targetGainPerKm: req.targetGainPerKm,
          prefer: req.prefer,
          surface: route.surface,
          waytype: route.waytype,
          allowOutAndBack: req.allowOutAndBack,
        }),
      });
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (!scored.length) {
    throw new OrsError(
      `No route could be planned. ${failures.join('; ') || 'openrouteservice returned nothing.'}`,
    );
  }

  scored.sort((a, b) => b.breakdown.total - a.breakdown.total);
  const routes = scored.slice(0, 3).map((r, i) => ({
    ...r,
    rank: i + 1,
    score: Number(r.breakdown.total.toFixed(3)),
  }));

  const best = routes[0].breakdown;
  if (best.spurs.spurs.length === 0 && best.overlap.ratio < 0.05) {
    rationale.push('Top route is a clean loop — no out-and-back sections, almost no retracing.');
  }

  return {
    routes,
    targetDistanceM,
    targetSource,
    rationale,
    attempted: scored.length + failures.length,
    failures,
  };
}

/** GPX 1.1 for a planned route, ready for the existing route-export path. */
export function routeToGpx(coordinates: Coord[], name: string): string {
  const points = coordinates
    .map(([lng, lat, ele]) => {
      const elevation = typeof ele === 'number' ? `<ele>${ele.toFixed(1)}</ele>` : '';
      return `<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">${elevation}</trkpt>`;
    })
    .join('');
  const safeName = name.replace(/[<>&]/g, '');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<gpx version="1.1" creator="strangeramblings.com/trails" xmlns="http://www.topografix.com/GPX/1/1">` +
    `<trk><name>${safeName}</name><trkseg>${points}</trkseg></trk>` +
    `</gpx>`
  );
}
