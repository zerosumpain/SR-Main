// The scoring atom: a Web Mercator slippy tile at z19.
//
// SERVER-ONLY (see rings.ts).
//
// Why a grid at all, when the brief asks for traced polygons: the app database
// is pgvector/pg16 with no PostGIS, so there is no ST_Polygonize, no
// ST_Difference and no planar partition to resolve one person's loop sitting
// inside another's. On a grid that whole problem is an argmax over a cell key.
// Family phones are polled at 120 s, so a "true" polygon of a block walk is a
// wonky hexagon made of sensor noise anyway; on a grid Life360 fixes and Apple
// watch fixes land in the same cells and the asymmetry disappears.
//
// z19 is ~44 m across at Darlington's latitude, ~1,970 m2. That is the size
// that makes nesting VISIBLE: a block walk encloses 4-9 cells at z19 against
// 1-4 at z18, so Katie's walk can actually punch a hole through John's loop.
//
// The integer arithmetic itself is not reimplemented here — it is the repo's
// existing $lib/trails/field/tile-math, and this module is the inverse plus the
// per-latitude constants it does not carry.

import { latLngToTile } from '$lib/trails/field/tile-math';
import type { Vec2 } from './rings';

/** The scoring zoom. Everything in this feature is keyed on it. */
export const TILE_ZOOM = 19;

/** Mean Earth radius, matching $lib/trails/track's haversine so distances agree. */
export const EARTH_RADIUS_M = 6371008.8;

/** Web Mercator's full-world span in metres at the equator. */
export const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * EARTH_RADIUS_M;

export interface Tile {
  x: number;
  y: number;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** The z19 cell a fix falls in. Delegates to the existing trails tile maths. */
export function tileAt(lat: number, lon: number, zoom = TILE_ZOOM): Tile {
  const t = latLngToTile(lat, lon, zoom);
  return { x: t.x, y: t.y };
}

/**
 * Inverse slippy transform for a LATTICE CORNER — integer (cx, cy) is the
 * north-west corner of tile (cx, cy), and (cx+1, cy+1) is its south-east one.
 * Fractional values are allowed, which is what makes `tileCentre` a one-liner.
 */
export function tileCorner(cx: number, cy: number, zoom = TILE_ZOOM): LatLon {
  const n = 2 ** zoom;
  const lon = (cx / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / n)));
  return { lat: (latRad * 180) / Math.PI, lon };
}

/**
 * FRACTIONAL slippy coordinates — the exact inverse of `tileCorner`.
 *
 * `latLngToTile` floors, which is right for "which cell is this fix in" and
 * useless for "which cells does the line between these two fixes pass through":
 * a grid traversal needs to know where inside the cell each end sits. This is
 * the same transform without the floor, and the trample rasteriser is its only
 * caller.
 */
export function tileFractional(lat: number, lon: number, zoom = TILE_ZOOM): Vec2 {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [x, y];
}

/**
 * The point a ring is tested against. Centroids, not overlap, decide capture:
 * a cell is yours if its middle is inside your loop, which is one predicate
 * with no partial-coverage tie-breaking to argue about.
 */
export function tileCentre(x: number, y: number, zoom = TILE_ZOOM): LatLon {
  return tileCorner(x + 0.5, y + 0.5, zoom);
}

/**
 * Ground width of a cell at a given latitude, metres.
 *
 * Mercator cells are square in PROJECTED space and shrink toward the poles on
 * the ground by cos(lat). This is the whole of the area model: the leaderboard
 * is cell count x this constant squared, so there is no geodesic library and no
 * projection bug to have.
 */
export function tileSideM(lat: number, zoom = TILE_ZOOM): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** ~1,970 m2 at 54.5N, z19. */
export function tileAreaM2(lat: number, zoom = TILE_ZOOM): number {
  const side = tileSideM(lat, zoom);
  return side * side;
}

/** Stable string key for a Map or a Set. Not a database key. */
export function tileKeyOf(x: number, y: number): string {
  return `${x}:${y}`;
}

export function parseTileKey(key: string): Tile {
  const [x, y] = key.split(':');
  return { x: Number(x), y: Number(y) };
}

export interface LocalProjection {
  refLat: number;
  refLon: number;
  /** Metres east, metres north of the reference point. */
  toM(lat: number, lon: number): Vec2;
  toLatLon(p: Vec2): LatLon;
}

/**
 * A flat metre frame centred on one point — an equirectangular projection with
 * the cos(lat) correction applied once, at the reference latitude.
 *
 * The correction is the part that matters. At 54.5N a degree of longitude is
 * 0.58 of a degree of latitude on the ground, so geometry done in raw degrees
 * reports a square walk as a 42%-too-wide rectangle and every area on the
 * leaderboard is wrong. Fixing cos(lat) at the reference rather than per point
 * costs under a metre over the couple of kilometres any single claim spans, and
 * it keeps the transform exactly invertible, which the round-trip test relies on.
 */
export function localProjection(refLat: number, refLon: number): LocalProjection {
  const metresPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const metresPerDegLon = metresPerDegLat * Math.cos((refLat * Math.PI) / 180);

  return {
    refLat,
    refLon,
    toM(lat: number, lon: number): Vec2 {
      return [(lon - refLon) * metresPerDegLon, (lat - refLat) * metresPerDegLat];
    },
    toLatLon(p: Vec2): LatLon {
      return {
        lat: refLat + p[1] / metresPerDegLat,
        lon: refLon + p[0] / metresPerDegLon,
      };
    },
  };
}
