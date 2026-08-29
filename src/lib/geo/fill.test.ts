import { describe, it, expect } from 'vitest';
import {
  closeTiles,
  dilateTiles,
  enclosedCells,
  erodeTiles,
  fillInterior,
  fillInteriorOfSegments,
  FILL_RADIUS_CELLS,
  MAX_FILL_TILES,
} from './fill';
import { tileKeyOf, type Tile } from './tiles';
import { detectLoops, trampledTiles } from './loops';
import { walk, square } from './test-fixtures';
import type { Vec2 } from './rings';

// A neutral lattice origin. Nothing here depends on a real latitude — this
// module is pure cell arithmetic and never touches a projection.
const OX = 262_000;
const OY = 161_000;

const at = (x: number, y: number): Tile => ({ x: OX + x, y: OY + y });
const keys = (tiles: Iterable<Tile>) => new Set([...tiles].map((t) => tileKeyOf(t.x, t.y)));
const has = (tiles: Iterable<Tile>, x: number, y: number) =>
  keys(tiles).has(tileKeyOf(OX + x, OY + y));

/** The outline of a w x h rectangle — a one-cell-wide wall, nothing inside. */
function ring(w: number, h: number): Tile[] {
  const out: Tile[] = [];
  for (let x = 0; x < w; x++) {
    out.push(at(x, 0));
    out.push(at(x, h - 1));
  }
  for (let y = 1; y < h - 1; y++) {
    out.push(at(0, y));
    out.push(at(w - 1, y));
  }
  return out;
}

/** Every cell strictly inside that outline. */
function interiorOf(w: number, h: number): Tile[] {
  const out: Tile[] = [];
  for (let x = 1; x < w - 1; x++) for (let y = 1; y < h - 1; y++) out.push(at(x, y));
  return out;
}

const drop = (tiles: Tile[], gone: Tile[]) => {
  const bad = keys(gone);
  return tiles.filter((t) => !bad.has(tileKeyOf(t.x, t.y)));
};

describe('dilate / erode / close', () => {
  it('dilation grows a single cell into a 3x3 square', () => {
    expect(dilateTiles([at(0, 0)], 1)).toHaveLength(9);
  });

  it('erosion is dilation undone on a solid block', () => {
    const solid: Tile[] = [];
    for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) solid.push(at(x, y));
    expect(erodeTiles(dilateTiles(solid, 1), 1)).toHaveLength(49);
  });

  it('erosion alone strips the rim', () => {
    const solid: Tile[] = [];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) solid.push(at(x, y));
    // 5x5 eroded by a 3x3 element is the middle 3x3.
    expect(erodeTiles(solid, 1)).toHaveLength(9);
  });

  it('closing is EXTENSIVE — every input cell survives it', () => {
    const wall = ring(9, 9);
    const closed = keys(closeTiles(wall, 1));
    for (const t of wall) expect(closed.has(tileKeyOf(t.x, t.y))).toBe(true);
  });

  it('closing seals a one-cell puncture', () => {
    const leaky = drop(ring(9, 9), [at(4, 0)]);
    expect(has(closeTiles(leaky, 1), 4, 0)).toBe(true);
  });

  it('closing seals a two-cell puncture but not a three-cell one', () => {
    // Radius 1 reaches one cell from each side of the hole, so two is the
    // widest gap it can bridge. This is the number the module's comment claims.
    const gap2 = drop(ring(11, 11), [at(4, 0), at(5, 0)]);
    expect(has(closeTiles(gap2, 1), 4, 0)).toBe(true);
    expect(has(closeTiles(gap2, 1), 5, 0)).toBe(true);

    const gap3 = drop(ring(11, 11), [at(4, 0), at(5, 0), at(6, 0)]);
    expect(has(closeTiles(gap3, 1), 5, 0)).toBe(false);
  });

  it('radius 0 is the identity', () => {
    const wall = ring(7, 7);
    expect(closeTiles(wall, 0)).toHaveLength(wall.length);
  });
});

describe('enclosedCells', () => {
  it('finds the middle of a closed wall', () => {
    const found = enclosedCells(ring(7, 7));
    expect(found.bboxOverflow).toBe(false);
    expect(keys(found.tiles)).toEqual(keys(interiorOf(7, 7)));
  });

  it('finds nothing when the wall is punctured', () => {
    expect(enclosedCells(drop(ring(7, 7), [at(3, 0)])).tiles).toHaveLength(0);
  });

  it('a DIAGONAL barrier seals, because the flood is four-connected', () => {
    // The two cells meet only at a corner. An eight-connected flood would slip
    // through the join and this ring would enclose nothing.
    const diamond = [at(1, 0), at(2, 1), at(1, 2), at(0, 1)];
    expect(keys(enclosedCells(diamond).tiles)).toEqual(keys([at(1, 1)]));
  });

  it('refuses a bounding box beyond the work guard', () => {
    const far = [at(0, 0), at(0, 1), at(1, 0), at(5000, 5000)];
    const found = enclosedCells(far, 250_000);
    expect(found.bboxOverflow).toBe(true);
    expect(found.tiles).toHaveLength(0);
  });

  it('is empty for an empty barrier', () => {
    expect(enclosedCells([]).tiles).toHaveLength(0);
  });
});

describe('fillInterior — the required shapes', () => {
  it('a perfect ring fills its middle', () => {
    const wall = ring(9, 9);
    const filled = fillInterior(wall);
    expect(filled.capped).toBe(false);
    expect(filled.bboxOverflow).toBe(false);
    expect(keys(filled.tiles)).toEqual(keys(interiorOf(9, 9)));
    expect(filled.interiorFound).toBe(49);
  });

  it('a straight line fills nothing', () => {
    const line: Tile[] = [];
    for (let x = 0; x < 40; x++) line.push(at(x, 0));
    expect(fillInterior(line).tiles).toHaveLength(0);
  });

  it('a wandering open path fills nothing', () => {
    // An out-and-back down two parallel streets four cells apart: it never
    // joins up at either end, so nothing is surrounded.
    const path: Tile[] = [];
    for (let x = 0; x < 30; x++) path.push(at(x, 0));
    for (let x = 0; x < 30; x++) path.push(at(x, 4));
    expect(fillInterior(path).tiles).toHaveLength(0);
  });

  it('a C-shape that does not close fills nothing', () => {
    // A 9x9 wall with a whole side missing. The mouth is 7 cells wide, far
    // beyond anything a radius-1 closing can bridge.
    const c = drop(ring(9, 9), [
      at(1, 0),
      at(2, 0),
      at(3, 0),
      at(4, 0),
      at(5, 0),
      at(6, 0),
      at(7, 0),
    ]);
    const filled = fillInterior(c);
    expect(filled.tiles).toHaveLength(0);
    expect(filled.interiorFound).toBe(0);
  });

  it('a ring with a ONE-CELL GAP does fill — this is the point of the closing', () => {
    const leaky = drop(ring(9, 9), [at(4, 0)]);

    // Without the closing there is nothing to find: prove the gap is real.
    expect(enclosedCells(leaky).tiles).toHaveLength(0);

    const filled = fillInterior(leaky);
    expect(filled.tiles.length).toBeGreaterThan(0);
    expect(keys(filled.tiles)).toEqual(keys(interiorOf(9, 9)));
  });

  it('a ring with a TWO-CELL gap fills; a three-cell gap does not', () => {
    const gap2 = drop(ring(11, 11), [at(4, 0), at(5, 0)]);
    expect(fillInterior(gap2).tiles.length).toBeGreaterThan(0);

    const gap3 = drop(ring(11, 11), [at(4, 0), at(5, 0), at(6, 0)]);
    expect(fillInterior(gap3).tiles).toHaveLength(0);
  });
});

describe('fillInterior — what is NOT awarded', () => {
  it('the DILATION HALO is never awarded', () => {
    const wall = ring(9, 9);
    const filled = fillInterior(wall);
    const awarded = keys([...wall, ...filled.tiles]);

    // Dilation grows a ring BOTH ways. The inward half lands on cells the fill
    // legitimately awards anyway, so the halo that matters — the one that would
    // be territory nobody went near — is the OUTWARD skirt: everything dilation
    // added beyond the walked outline. Not one of those may be awarded.
    const skirt = drop(drop(dilateTiles(wall, 1), wall), interiorOf(9, 9));
    expect(skirt.length).toBe(40); // an 11x11 boundary ring
    for (const t of skirt) expect(awarded.has(tileKeyOf(t.x, t.y))).toBe(false);

    // Stated as a total as well as a membership: the ring plus its middle is
    // exactly the 9x9 square and nothing outside it.
    expect(awarded.size).toBe(81);
    for (const t of awarded) {
      const [x, y] = [...t.split(':')].map(Number);
      expect(x).toBeGreaterThanOrEqual(OX);
      expect(x).toBeLessThanOrEqual(OX + 8);
      expect(y).toBeGreaterThanOrEqual(OY);
      expect(y).toBeLessThanOrEqual(OY + 8);
    }
  });

  it('the BRIDGE cell the closing invented is not awarded either', () => {
    const leaky = drop(ring(9, 9), [at(4, 0)]);
    const filled = fillInterior(leaky);

    // The closing sealed (4,0) so the flood could not escape...
    expect(has(closeTiles(leaky, 1), 4, 0)).toBe(true);
    expect(filled.bridged).toBeGreaterThan(0);
    // ...but the walker never went there, so it is not in the award.
    expect(has(filled.tiles, 4, 0)).toBe(false);
    expect(has([...leaky, ...filled.tiles], 4, 0)).toBe(false);
  });

  it('the fill is always disjoint from the input — no cell is paid twice', () => {
    const wall = ring(13, 13);
    const filled = fillInterior(wall);
    const input = keys(wall);
    for (const t of filled.tiles) expect(input.has(tileKeyOf(t.x, t.y))).toBe(false);
  });

  it('a solid blob has no interior left to award', () => {
    const solid: Tile[] = [];
    for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) solid.push(at(x, y));
    // A journey whose ring already captured its middle gains nothing from fill,
    // which is what keeps loop and fill from double-paying the same ground.
    expect(fillInterior(solid).tiles).toHaveLength(0);
  });
});

describe('fillInterior — the strict pass', () => {
  it('a hole SMALLER than the structuring element still fills', () => {
    // A 2x2 courtyard inside a solid block. The closing absorbs it, so the
    // lenient flood alone would award nothing; the raw flood sees it.
    const solid: Tile[] = [];
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) solid.push(at(x, y));
    const yard = [at(3, 3), at(4, 3), at(3, 4), at(4, 4)];
    const walls = drop(solid, yard);

    expect(enclosedCells(closeTiles(walls, 1)).tiles).toHaveLength(0);

    const filled = fillInterior(walls);
    expect(keys(filled.tiles)).toEqual(keys(yard));
  });

  it('a single pinhole in a trampled blob is filled', () => {
    const solid: Tile[] = [];
    for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) solid.push(at(x, y));
    const walls = drop(solid, [at(2, 2)]);
    expect(keys(fillInterior(walls).tiles)).toEqual(keys([at(2, 2)]));
  });
});

describe('fillInterior — the guard rail', () => {
  it('the cap fires on a huge ring, and awards NOTHING', () => {
    // A 40x40 outline encloses 38x38 = 1,444 cells, over the 1,000 ceiling.
    const huge = ring(40, 40);
    const filled = fillInterior(huge);
    expect(filled.capped).toBe(true);
    expect(filled.tiles).toHaveLength(0);
    // The count is still reported, so a retune can be argued from it.
    expect(filled.interiorFound).toBe(38 * 38);
    expect(filled.interiorFound).toBeGreaterThan(MAX_FILL_TILES);
  });

  it('rejects whole rather than truncating', () => {
    const huge = ring(40, 40);
    expect(fillInterior(huge, { maxFillTiles: 1000 }).tiles).toHaveLength(0);
  });

  it('a ring just under the cap is paid in full', () => {
    // 33x33 outline encloses 31x31 = 961 cells.
    const big = ring(33, 33);
    const filled = fillInterior(big);
    expect(filled.capped).toBe(false);
    expect(filled.tiles).toHaveLength(961);
  });

  it('the cap defaults to the ring ceiling, and both are 1,000', () => {
    expect(MAX_FILL_TILES).toBe(1000);
    expect(fillInterior(ring(9, 9)).maxFillTiles).toBe(1000);
    expect(FILL_RADIUS_CELLS).toBe(1);
  });

  it('the work guard refuses an absurd bounding box without hanging', () => {
    const scattered = [at(0, 0), at(0, 1), at(1, 0), at(1, 1), at(100_000, 100_000)];
    const filled = fillInterior(scattered);
    expect(filled.bboxOverflow).toBe(true);
    expect(filled.tiles).toHaveLength(0);
  });
});

describe('fillInterior — housekeeping', () => {
  it('is order-independent and deterministic', () => {
    const wall = ring(11, 11);
    const a = fillInterior(wall).tiles;
    const b = fillInterior([...wall].reverse()).tiles;
    expect(b).toEqual(a);
  });

  it('handles trivial and malformed input', () => {
    expect(fillInterior([]).tiles).toHaveLength(0);
    expect(fillInterior([at(0, 0)]).tiles).toHaveLength(0);
    expect(fillInterior([at(0, 0), at(1, 0), at(0, 1)]).tiles).toHaveLength(0);
    expect(
      fillInterior([...ring(9, 9), { x: Number.NaN, y: 3 }]).tiles.length,
    ).toBeGreaterThan(0);
  });

  it('fills two separate rings independently', () => {
    const a = ring(7, 7);
    const b = ring(7, 7).map((t) => ({ x: t.x + 40, y: t.y }));
    const filled = fillInterior([...a, ...b]);
    expect(filled.tiles).toHaveLength(25 * 2);
  });
});

// ---------------------------------------------------------------------------
// Against the REAL rasteriser
//
// Everything above works on hand-built cell sets. These two go through
// `trampledTiles`, because the whole feature rests on an assumption about its
// output that nothing else tests: that the painted corridor is FOUR-connected.
// Amanatides-Woo steps one lattice axis at a time and so never leaves a
// diagonal-only join — but if it ever did, the four-connected flood would pour
// straight through the corner and every fill in production would silently
// return nothing. That failure has no symptom other than a feature that quietly
// does not work.
// ---------------------------------------------------------------------------

describe('fillInterior over a rasterised walk', () => {
  it('a 400 m square walk seals, and its middle fills', () => {
    const fixes = walk(square(400));
    const painted = trampledTiles(fixes).tiles;
    const filled = fillInterior(painted);

    expect(filled.tiles.length).toBeGreaterThan(20);
    // The corridor is one cell wide, so a 400 m square (~9 cells) leaves a
    // roughly 7x7 middle.
    expect(filled.tiles.length).toBeLessThan(80);
    for (const t of filled.tiles) {
      expect(painted.some((p) => p.x === t.x && p.y === t.y)).toBe(false);
    }
  });

  it('a DIAGONAL square walk seals too — the corridor has no corner leaks', () => {
    // The same loop rotated 45 degrees to the lattice, which is the shape that
    // would expose a Bresenham-style rasteriser's diagonal holes.
    const d = 300;
    const diamond: Vec2[] = [
      [0, -d],
      [d, 0],
      [0, d],
      [-d, 0],
      [0, -d],
    ];
    const painted = trampledTiles(walk(diamond)).tiles;
    expect(fillInterior(painted).tiles.length).toBeGreaterThan(20);
  });

  it('a 600 m out-and-back seals nothing', () => {
    const there: Vec2[] = [
      [0, 0],
      [600, 0],
      [0, 0],
    ];
    expect(fillInterior(trampledTiles(walk(there)).tiles).tiles).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// fillInteriorOfSegments — the gates the fill has to keep honouring
// ---------------------------------------------------------------------------

describe('fillInteriorOfSegments — a cut journey stays cut', () => {
  it('a ring broken into ONE-CELL segments fills nothing, though its union would', () => {
    // The shape of a fast circuit after the 25 km/h gate: every leg refused,
    // so each surviving fix is its own segment, yet the fix cells together
    // still draw an unbroken wall around the block.
    const wall = ring(12, 12);
    expect(fillInterior(wall).tiles).toHaveLength(100);
    const asCut = wall.map((t) => [t]);
    const cut = fillInteriorOfSegments(asCut);
    expect(cut.tiles).toHaveLength(0);
    expect(cut.interiorFound).toBe(0);
  });

  it('one continuous segment is exactly what fillInterior would have said', () => {
    const wall = ring(12, 12);
    const whole = fillInterior(wall);
    const one = fillInteriorOfSegments([wall]);
    expect(keys(one.tiles)).toEqual(keys(whole.tiles));
    expect(one.bridged).toBe(whole.bridged);
  });

  it('two segments each seal their OWN ring, and neither borrows the other', () => {
    const a = ring(9, 9);
    const b = ring(9, 9).map((t) => ({ x: t.x + 40, y: t.y }));
    const both = fillInteriorOfSegments([a, b]);
    expect(both.tiles).toHaveLength(49 + 49);
  });

  it('ground one segment encircled and ANOTHER walked is not paid twice', () => {
    const wall = ring(9, 9);
    // A second segment that walks straight through the middle of the first.
    const through = [] as Tile[];
    for (let x = 1; x < 8; x++) through.push(at(x, 4));
    const out = fillInteriorOfSegments([wall, through]);
    // The middle row is trample, so it is never in the fill set.
    for (let x = 1; x < 8; x++) expect(has(out.tiles, x, 4)).toBe(false);
    expect(out.tiles).toHaveLength(49 - 7);
  });

  it('the ceiling belongs to the JOURNEY, not to each of its pieces', () => {
    // Two rings of 900 cells apiece: 1,800 together, over the 1,000 ceiling.
    // Capped per segment both would pass; capped per journey neither does.
    const a = ring(32, 32);
    const b = ring(32, 32).map((t) => ({ x: t.x + 80, y: t.y }));
    const out = fillInteriorOfSegments([a, b], { maxFillTiles: MAX_FILL_TILES });
    expect(out.interiorFound).toBe(30 * 30 * 2);
    expect(out.capped).toBe(true);
    expect(out.tiles).toHaveLength(0);
  });

  it('empty and degenerate input is inert', () => {
    expect(fillInteriorOfSegments([]).tiles).toHaveLength(0);
    expect(fillInteriorOfSegments([[], []]).tiles).toHaveLength(0);
    expect(fillInteriorOfSegments([[at(0, 0)]]).tiles).toHaveLength(0);
  });
});

describe('fillInteriorOfSegments over a real rasterised circuit', () => {
  /**
   * A workout track's fixes, as `readWorkoutOutings` actually builds them:
   * `activity_tracks.coordinates` carries no accuracy, no mode and no reported
   * speed, so the ONLY speed defence on this path is the implied-speed leg cut
   * — and that cut removes the interpolation between fixes without removing
   * the fixes themselves.
   */
  const workoutFixes = (corners: Vec2[], kmh: number, stepM = 10) =>
    walk(corners, { stepM, speedMps: kmh / 3.6 }).map((f) => ({
      lat: f.lat,
      lon: f.lon,
      ts: f.ts,
      activityType: 'ride',
    }));

  /** The cells each cleaned segment left behind, as the ingest builds them. */
  const partsOf = (fixes: ReturnType<typeof workoutFixes>) => {
    const loops = detectLoops(fixes);
    return loops.segments.map((seg, i) => [
      ...trampledTiles(seg).tiles,
      ...loops.rings.filter((r) => r.segmentIndex === i).flatMap((r) => r.tiles),
    ]);
  };

  // Fixture retuned by Amendment 2 (the activity-aware speed ceiling), NOT the
  // property. What is being tested is that a journey the gates SEVERED cannot be
  // welded back into a ring by the fill, and that is unchanged. The fixture used
  // to ride the circuit at 32 km/h because 32 km/h was over the ceiling for
  // everything; a declared `ride` is now judged at 45 km/h, so 32 km/h is a
  // ride that legitimately survives whole and proves nothing here. 70 km/h is
  // the same trap with a speed the gate still cuts — a drive logged as a ride,
  // which is exactly the journey the welding trap would have paid out.
  it('an 800 m circuit driven at 70 km/h wins NO interior — the speed gate holds', () => {
    const fast = workoutFixes(square(800), 70);
    const loops = detectLoops(fast);
    // The gate really did cut it, and no ring survived.
    expect(loops.segments.length).toBeGreaterThan(50);
    expect(loops.rings).toHaveLength(0);
    // And the cells it left really do seal — this is the trap, not a hypothetical.
    const union = loops.segments.flatMap((s) => trampledTiles(s).tiles);
    expect(fillInterior(union).tiles.length).toBeGreaterThan(200);
    // Segment by segment, it wins nothing.
    expect(fillInteriorOfSegments(partsOf(fast)).tiles).toHaveLength(0);
  });

  it('the same circuit at 22 km/h is one segment, closes, and fill adds nothing', () => {
    const ok = workoutFixes(square(800), 22);
    const loops = detectLoops(ok);
    expect(loops.segments).toHaveLength(1);
    expect(loops.rings).toHaveLength(1);
    // It closed, so the ring already owns the middle and there is nothing left.
    expect(fillInteriorOfSegments(partsOf(ok)).tiles).toHaveLength(0);
  });

  it('a wandering walk that never closes still wins its middle', () => {
    // Round a block group, then a long tail away, so the two ends finish far
    // apart and no closure test can see it.
    const wander = workoutFixes([...square(320), [-1000, 0]] as Vec2[], 5);
    const loops = detectLoops(wander);
    expect(loops.segments).toHaveLength(1);
    expect(loops.rings).toHaveLength(0);
    expect(fillInteriorOfSegments(partsOf(wander)).tiles.length).toBeGreaterThan(20);
  });
});
