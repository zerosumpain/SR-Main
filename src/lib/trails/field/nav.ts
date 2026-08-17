// Navigation maths for the field kit: how far off the line you are, how far
// through the route, and how long it should take.
//
// Ported from JKAImaps, but reimplemented on the existing haversine rather
// than @turf/* — the SR repo has no turf, and pulling in five packages to
// measure a point-to-segment distance is not a trade worth making.

import { haversineM } from '../track';

export type LngLat = [number, number];

export interface NearestPoint {
  distanceM: number;
  point: LngLat;
  /** Index of the segment start the nearest point falls on. */
  segmentIndex: number;
  /** Distance along the route to that point, in metres. */
  alongM: number;
}

/**
 * Closest point on a segment to `p`, in local planar coordinates.
 *
 * Latitude/longitude is projected to metres before the projection maths so a
 * degree east and a degree north are comparable — at 53°N a degree of
 * longitude is about 0.6 of a degree of latitude, and skipping this makes the
 * "nearest" point visibly wrong on east-west lanes.
 */
function projectOntoSegment(p: LngLat, a: LngLat, b: LngLat): { point: LngLat; t: number } {
  const latScale = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180) || 1e-6;
  const ax = a[0] * latScale;
  const ay = a[1];
  const bx = b[0] * latScale;
  const by = b[1];
  const px = p[0] * latScale;
  const py = p[1];

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { point: a, t: 0 };

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return { point: [(ax + dx * t) / latScale, ay + dy * t], t };
}

export function nearestPointOnRoute(position: LngLat, route: LngLat[]): NearestPoint | null {
  if (route.length < 2) return null;

  let best: NearestPoint | null = null;
  let cumulative = 0;

  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const segmentLength = haversineM(a, b);
    const { point, t } = projectOntoSegment(position, a, b);
    const distanceM = haversineM(position, point);

    if (!best || distanceM < best.distanceM) {
      best = {
        distanceM,
        point,
        segmentIndex: i - 1,
        alongM: cumulative + segmentLength * t,
      };
    }
    cumulative += segmentLength;
  }

  return best;
}

const DEFAULT_OFF_ROUTE_M = 50;

export function isOffRoute(distanceM: number, thresholdM = DEFAULT_OFF_ROUTE_M): boolean {
  return distanceM > thresholdM;
}

export interface RouteProgress {
  alongM: number;
  totalM: number;
  fraction: number;
  remainingM: number;
  offRouteM: number;
  offRoute: boolean;
}

export function routeProgress(
  position: LngLat,
  route: LngLat[],
  thresholdM = DEFAULT_OFF_ROUTE_M,
): RouteProgress | null {
  const nearest = nearestPointOnRoute(position, route);
  if (!nearest) return null;

  let totalM = 0;
  for (let i = 1; i < route.length; i++) totalM += haversineM(route[i - 1], route[i]);

  return {
    alongM: nearest.alongM,
    totalM,
    fraction: totalM > 0 ? Math.min(1, nearest.alongM / totalM) : 0,
    remainingM: Math.max(0, totalM - nearest.alongM),
    offRouteM: nearest.distanceM,
    offRoute: isOffRoute(nearest.distanceM, thresholdM),
  };
}

// ——— Time estimates ——————————————————————————————————————————————

// Naismith's rule, per sport. Base speeds in km/h; the ascent penalty is extra
// seconds per metre climbed.
const BASE_SPEED_KMH: Record<string, number> = {
  walk: 5,
  hike: 4.5,
  run: 10,
  trail_run: 8.5,
  ride: 22,
  mtb: 14,
};

const ASCENT_PENALTY_S_PER_M: Record<string, number> = {
  walk: 3.6,
  hike: 6,
  run: 4.5,
  trail_run: 6,
  ride: 2.4,
  mtb: 3.6,
};

/** Estimated moving time in seconds for a distance and its climb. */
export function estimateTimeS(distanceM: number, ascentM: number, sport: string): number {
  if (distanceM <= 0) return 0;
  const speed = BASE_SPEED_KMH[sport] ?? BASE_SPEED_KMH.walk;
  const penalty = ASCENT_PENALTY_S_PER_M[sport] ?? ASCENT_PENALTY_S_PER_M.walk;
  return (distanceM / 1000 / speed) * 3600 + Math.max(0, ascentM) * penalty;
}
