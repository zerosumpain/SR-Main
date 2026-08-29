import { describe, it, expect } from 'vitest';
import { latLngToTile } from '$lib/trails/field/tile-math';
import {
  TILE_ZOOM,
  tileAt,
  tileCentre,
  tileCorner,
  tileSideM,
  tileAreaM2,
  tileKeyOf,
  parseTileKey,
  localProjection,
} from './tiles';

const DARLINGTON = { lat: 54.5236, lon: -1.5536 };

describe('tiles', () => {
  it('defaults to z19, the scoring atom', () => {
    expect(TILE_ZOOM).toBe(19);
  });

  it('agrees with the existing trails tile maths', () => {
    const mine = tileAt(DARLINGTON.lat, DARLINGTON.lon);
    const theirs = latLngToTile(DARLINGTON.lat, DARLINGTON.lon, TILE_ZOOM);
    expect(mine).toEqual({ x: theirs.x, y: theirs.y });
  });

  it('round-trips a centroid back into its own tile', () => {
    const t = tileAt(DARLINGTON.lat, DARLINGTON.lon);
    const c = tileCentre(t.x, t.y);
    expect(tileAt(c.lat, c.lon)).toEqual(t);
  });

  it('puts the centroid inside the tile it names, not on a corner', () => {
    const t = tileAt(DARLINGTON.lat, DARLINGTON.lon);
    const nw = tileCorner(t.x, t.y);
    const se = tileCorner(t.x + 1, t.y + 1);
    const c = tileCentre(t.x, t.y);
    expect(c.lat).toBeLessThan(nw.lat);
    expect(c.lat).toBeGreaterThan(se.lat);
    expect(c.lon).toBeGreaterThan(nw.lon);
    expect(c.lon).toBeLessThan(se.lon);
  });

  it('a z19 cell at 54.5N is ~44 m across and ~1,970 m2', () => {
    expect(tileSideM(54.5)).toBeGreaterThan(43);
    expect(tileSideM(54.5)).toBeLessThan(45);
    expect(tileAreaM2(54.5)).toBeGreaterThan(1900);
    expect(tileAreaM2(54.5)).toBeLessThan(2050);
  });

  it('area is the square of the side, so a leaderboard is count x constant', () => {
    const side = tileSideM(DARLINGTON.lat);
    expect(tileAreaM2(DARLINGTON.lat)).toBeCloseTo(side * side, 6);
  });

  it('cells shrink toward the pole', () => {
    expect(tileSideM(0)).toBeGreaterThan(tileSideM(54.5));
    expect(tileSideM(54.5)).toBeGreaterThan(tileSideM(70));
  });

  it('tile keys round-trip', () => {
    expect(parseTileKey(tileKeyOf(123456, 78910))).toEqual({ x: 123456, y: 78910 });
  });

  describe('local metre projection', () => {
    const proj = localProjection(DARLINGTON.lat, DARLINGTON.lon);

    it('places the reference point at the origin', () => {
      expect(proj.toM(DARLINGTON.lat, DARLINGTON.lon)).toEqual([0, 0]);
    });

    it('round-trips metres through lat/lon', () => {
      const p = proj.toLatLon([300, -450]);
      const back = proj.toM(p.lat, p.lon);
      expect(back[0]).toBeCloseTo(300, 4);
      expect(back[1]).toBeCloseTo(-450, 4);
    });

    it('corrects longitude for cos(lat) so 100 m east is 100 m on the ground', () => {
      const east = proj.toLatLon([100, 0]);
      const north = proj.toLatLon([0, 100]);
      // At 54.5N a degree of longitude is ~0.58 of a degree of latitude, so an
      // uncorrected projection would put these two at the same offset.
      const dLon = Math.abs(east.lon - DARLINGTON.lon);
      const dLat = Math.abs(north.lat - DARLINGTON.lat);
      expect(dLon / dLat).toBeGreaterThan(1.5);
    });
  });
});
