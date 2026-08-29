import { describe, it, expect } from 'vitest';
import { chaikin, connectedComponents, dissolveTiles } from './dissolve';
import { tileAt, tileKeyOf, type Tile } from './tiles';
import { ringArea, signedArea, type Vec2 } from './rings';
import { ORIGIN } from './test-fixtures';

const base = tileAt(ORIGIN.lat, ORIGIN.lon);

function block(w: number, h: number, ox = 0, oy = 0): Tile[] {
  const out: Tile[] = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) out.push({ x: base.x + ox + x, y: base.y + oy + y });
  return out;
}

const without = (tiles: Tile[], holes: Tile[]) => {
  const drop = new Set(holes.map((t) => tileKeyOf(t.x, t.y)));
  return tiles.filter((t) => !drop.has(tileKeyOf(t.x, t.y)));
};

describe('connectedComponents', () => {
  it('groups 4-connected tiles into one component', () => {
    expect(connectedComponents(block(10, 10))).toHaveLength(1);
  });

  it('keeps disjoint blocks apart', () => {
    const comps = connectedComponents([...block(4, 4), ...block(4, 4, 20, 20)]);
    expect(comps).toHaveLength(2);
    expect(comps.map((c) => c.length).sort()).toEqual([16, 16]);
  });

  it('diagonal touching is not connection', () => {
    expect(
      connectedComponents([
        { x: base.x, y: base.y },
        { x: base.x + 1, y: base.y + 1 },
      ]),
    ).toHaveLength(2);
  });

  it('is order-independent', () => {
    const tiles = block(6, 6);
    const a = connectedComponents(tiles).map((c) => c.length);
    const b = connectedComponents([...tiles].reverse()).map((c) => c.length);
    expect(a).toEqual(b);
  });
});

describe('chaikin', () => {
  const sq: Vec2[] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];

  it('doubles the vertex count per pass on a closed ring', () => {
    expect(chaikin(sq, 1)).toHaveLength(8);
    expect(chaikin(sq, 2)).toHaveLength(16);
    expect(chaikin(sq, 0)).toHaveLength(4);
  });

  it('stays inside the original ring and rounds the corners', () => {
    const smoothed = chaikin(sq, 2);
    for (const [x, y] of smoothed) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(100 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(100 + 1e-9);
    }
    // Exactly 0.84375 of the original: each pass takes a fixed bite out of the
    // corners. Pinned rather than bounded, because it is why the leaderboard
    // measures area as cell count x the per-latitude constant and never as the
    // smoothed ring's shoelace — the drawn shape is 16% smaller than the ground
    // it stands for, and reading area off the picture would under-report every
    // player by the same silent margin.
    expect(ringArea(smoothed)).toBeCloseTo(ringArea(sq) * 0.84375, 6);
  });

  it('leaves a degenerate ring alone', () => {
    expect(chaikin([[0, 0], [1, 1]], 2)).toHaveLength(2);
  });
});

describe('dissolveTiles', () => {
  it('turns 100 tiles into ONE ring, not 100', () => {
    const regions = dissolveTiles(block(10, 10));
    expect(regions).toHaveLength(1);
    expect(regions[0].tileCount).toBe(100);
    expect(regions[0].holes).toHaveLength(0);
    // 4 corners, collinear runs collapsed, then two Chaikin passes.
    expect(regions[0].outer.length).toBe(16);
  });

  it('output stays in the tens of rings for hundreds of tiles', () => {
    const regions = dissolveTiles(block(20, 20));
    const rings = regions.reduce((n, r) => n + 1 + r.holes.length, 0);
    expect(regions[0].tileCount).toBe(400);
    expect(rings).toBeLessThan(10);
  });

  it('punches a hole through the middle — this is the nesting picture', () => {
    const regions = dissolveTiles(without(block(10, 10), block(2, 2, 4, 4)));
    expect(regions).toHaveLength(1);
    expect(regions[0].tileCount).toBe(96);
    expect(regions[0].holes).toHaveLength(1);
    expect(regions[0].holes[0].length).toBeGreaterThanOrEqual(8);
  });

  it('returns one region per connected component', () => {
    const regions = dissolveTiles([...block(5, 5), ...block(3, 3, 30, 0)]);
    expect(regions).toHaveLength(2);
    expect(regions.map((r) => r.tileCount).sort((a, b) => a - b)).toEqual([9, 25]);
  });

  it('emits real lat/lon near the tiles it came from', () => {
    const regions = dissolveTiles(block(10, 10));
    for (const [lon, lat] of regions[0].outer) {
      expect(Math.abs(lat - ORIGIN.lat)).toBeLessThan(0.02);
      expect(Math.abs(lon - ORIGIN.lon)).toBeLessThan(0.02);
    }
  });

  it('an L-shape keeps its notch rather than becoming a rectangle', () => {
    // 10x10 minus the top-right 5x5 quadrant.
    const regions = dissolveTiles(without(block(10, 10), block(5, 5, 5, 0)));
    expect(regions).toHaveLength(1);
    expect(regions[0].tileCount).toBe(75);
    expect(regions[0].holes).toHaveLength(0);
    // Six corners before smoothing, so 24 after two passes.
    expect(regions[0].outer.length).toBe(24);
  });

  it('winds the outer boundary and its holes opposite ways', () => {
    // The renderer needs this: an SVG path with a hole only shows the hole when
    // the two sub-paths have opposite winding under the nonzero fill rule.
    const tiles = without(block(10, 10), block(2, 2, 4, 4));
    const regions = dissolveTiles(tiles, { chaikinPasses: 0 });
    const outer = signedArea(regions[0].outer as unknown as Vec2[]);
    const hole = signedArea(regions[0].holes[0] as unknown as Vec2[]);
    expect(Math.sign(outer)).not.toBe(Math.sign(hole));
    expect(Math.abs(outer)).toBeGreaterThan(Math.abs(hole));
  });

  it('is empty for no tiles', () => {
    expect(dissolveTiles([])).toEqual([]);
  });
});
