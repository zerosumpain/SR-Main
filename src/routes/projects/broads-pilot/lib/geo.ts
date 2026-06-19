// Pure geographic helpers (metres). Shared by the engine and the build scripts.
import type { LatLng } from './types';

const R = 6371000; // mean Earth radius, metres
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance between two [lat,lng] points, in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Summed length of a polyline, in metres. */
export function polylineLength(pts: LatLng[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversine(pts[i - 1], pts[i]);
  return s;
}

/** Index of the point in `pts` closest to `target` (−1 if empty). */
export function nearestIndex(target: LatLng, pts: LatLng[]): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = haversine(target, pts[i]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Distance (m) from point p to the segment a–b (local equirectangular projection). */
export function distToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  return projectToSegment(p, a, b).dist;
}

/** Foot-of-perpendicular projection of p onto segment a–b: the distance (m) and
 *  the clamped parameter t∈[0,1] of the nearest point along a→b. */
export function projectToSegment(p: LatLng, a: LatLng, b: LatLng): { dist: number; t: number } {
  const k = Math.cos((p[0] * Math.PI) / 180) * 111320;
  const px = p[1] * k, py = p[0] * 111320;
  const ax = a[1] * k, ay = a[0] * 111320;
  const bx = b[1] * k, by = b[0] * 111320;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { dist: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}
