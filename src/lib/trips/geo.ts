// src/lib/trips/geo.ts
//
// Small geometry helpers for the trip planner's routing layer: decoding the
// encoded polylines Transitous returns and thinning a leg's line to the ≤ 300
// points a stored plan carries (model.ts `PlannedLeg.line`). PURE.

import type { LatLng } from './model';

/** The most points a stored leg line may carry (model.ts). */
export const MAX_LINE_POINTS = 300;

/**
 * Decode a Google-style encoded polyline. Transitous (MOTIS) sends
 * `legGeometry.points` with `precision: 7`; ORS and Google use 5.
 */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const out: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    out.push({ lat: lat / factor, lng: lng / factor });
  }
  return out;
}

/** Perpendicular distance of p from segment a→b, in degrees (fine at city scale). */
function offset(p: LatLng, a: LatLng, b: LatLng): number {
  const scale = Math.cos((a.lat * Math.PI) / 180);
  const ax = a.lng * scale, ay = a.lat;
  const bx = b.lng * scale, by = b.lat;
  const px = p.lng * scale, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function douglasPeucker(points: LatLng[], tolerance: number): LatLng[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let worst = -1;
    let worstAt = -1;
    for (let i = from + 1; i < to; i++) {
      const d = offset(points[i], points[from], points[to]);
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worstAt > 0 && worst > tolerance) {
      keep[worstAt] = 1;
      stack.push([from, worstAt], [worstAt, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Thin a line to at most `max` points, keeping its shape: Douglas–Peucker with
 * a tolerance that doubles until the line fits. Coordinates are rounded to six
 * decimals (about 10 cm), which is all a drawn line needs.
 */
export function simplifyLine(points: LatLng[], max = MAX_LINE_POINTS): LatLng[] {
  const round = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });
  if (points.length <= max) return points.map(round);
  let tolerance = 0.00001;
  let out = douglasPeucker(points, tolerance);
  while (out.length > max) {
    tolerance *= 2;
    out = douglasPeucker(points, tolerance);
  }
  return out.map(round);
}

/** `[lng, lat]` GeoJSON pairs to LatLng objects (never an unlabelled pair on the wire). */
export function fromLngLat(pairs: Array<[number, number] | number[]>): LatLng[] {
  return pairs
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => ({ lat: Number(p[1]), lng: Number(p[0]) }));
}
