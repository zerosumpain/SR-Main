// src/lib/home/presence/geo.ts
//
// The geometry the places map draws and edits with. PURE, and deliberately
// self-contained: it ships to the browser with the map, so it imports nothing
// that would drag the presence code's server half along.
//
// A place is a centre and a radius. On the map it is drawn as a 64-sided
// polygon (Mapbox has no geodesic circle), edited with a centre handle and an
// east-edge handle whose distance from the centre IS the radius.
//
// The distance is the same haversine, on the same 6371 km sphere, as
// `metresBetween` in cluster.ts — the edge the owner drags must be the edge
// `detectCrossings` measures, or "inside the circle" on the map would disagree
// with "arrived" in an alert. The test pins the two together.

/** The radius the owner may set, in metres. Mirrors RADIUS_MIN_M/MAX_M in
 *  places.ts (which imports these rather than keep its own copy). */
export const RADIUS_MIN_M = 50;
export const RADIUS_MAX_M = 2000;
/** A new place dropped on the map starts this wide. */
export const NEW_PLACE_RADIUS_M = 150;

const EARTH_R_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres. */
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point `distM` metres from (lat, lon) on an initial bearing in degrees
 *  (0 = north, 90 = east). */
export function destinationPoint(lat: number, lon: number, distM: number, bearingDeg: number): { lat: number; lon: number } {
  const d = distM / EARTH_R_M;
  const b = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(b));
  const λ2 = λ1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}

/**
 * A closed GeoJSON ring approximating the circle: `[lon, lat]` pairs (GeoJSON
 * order, not the site's lat/lon), first vertex repeated last.
 */
export function circlePolygon(lat: number, lon: number, radiusM: number, steps = 64): [number, number][] {
  const n = Math.max(3, Math.floor(steps));
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = destinationPoint(lat, lon, radiusM, (i * 360) / n);
    ring.push([p.lon, p.lat]);
  }
  ring.push(ring[0]);
  return ring;
}

/** A radius the owner may set: whole metres, 50–2000. Nonsense is the floor. */
export function clampRadius(m: number): number {
  if (!Number.isFinite(m)) return RADIUS_MIN_M;
  return Math.min(RADIUS_MAX_M, Math.max(RADIUS_MIN_M, Math.round(m)));
}

/** Why a place's geometry would be refused, or null when it is fine. The
 *  server checks this on every write; the map only ever produces valid
 *  values, but a form action is a POST anyone can make. */
export function validPlaceGeometry(lat: number, lon: number, radiusM: number): string | null {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'The latitude must be between -90 and 90.';
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return 'The longitude must be between -180 and 180.';
  if (!Number.isFinite(radiusM) || radiusM < RADIUS_MIN_M || radiusM > RADIUS_MAX_M) {
    return `The radius must be ${RADIUS_MIN_M}–${RADIUS_MAX_M} m.`;
  }
  return null;
}
