// The interior of encircled ground.
//
// SERVER-ONLY (see rings.ts).
//
// WHY THIS EXISTS
//
// `detectLoops` asks a POLYLINE question: do the two ends of this track meet,
// or does the track cross itself? Measured over production's 837 workout tracks
// of >= 400 m, that question is answerable for 149 of them — 81 close on
// endpoint proximity, 68 more within 5% of path length — and 130 of those 149
// already produce a claim. The detector is not broken.
//
// The other 688 tracks, 82% of the corpus, do not close at all: their average
// end-to-end gap is 1,851 m. John's description of them is exact — "lots of
// 'snail trail' captures that are a full loop" — and the reason polyline
// closure cannot see it is that a wandering route can encircle a block
// perfectly while its two ENDS finish a mile apart. Closure of the path and
// enclosure of the ground are different properties, and only the second one is
// what the game is about.
//
// So this module asks the grid question instead. Once a journey is a SET OF
// CELLS, "did this encircle anything" is not a geometry problem at all: it is
// "is there an empty cell the outside cannot reach". That is a flood fill, it
// needs no closure test, no winding number and no ring, and it works identically
// on a track that closes and one that does not.
//
// THE THREE STEPS
//
//  1. CLOSING (dilate, then erode) at a one-cell radius. The spec's rule is
//     "geos don't need to be perfectly closed, but need to be close to closed",
//     and on a grid that sentence has a precise meaning: a barrier with a hole
//     narrower than the structuring element is still a barrier. A 45 s sampling
//     gap, a cut leg, or a street the walker crossed at a slight diagonal all
//     leave a one-cell puncture in an otherwise complete ring, and without this
//     step the flood pours through it and the whole block scores nothing.
//     Closing is EXTENSIVE (S is always a subset of close(S)), so it can only
//     ever seal, never erase.
//
//  2. FLOOD the complement from OUTSIDE the bounding box. Every empty cell the
//     flood reaches is outside; every empty cell it cannot reach is enclosed.
//     Starting from outside rather than from a seed inside is what makes this
//     need no guess about where the middle is.
//
//     The flood is run TWICE — once against the closed barrier and once against
//     the raw one — and the two results unioned. That is not belt and braces;
//     it repairs a real regression the closing introduces on its own. A closing
//     fills any hole the structuring element cannot fit inside, so at radius 1
//     an enclosed area smaller than 3x3 cells (~132 m square) is absorbed INTO
//     the barrier and never awarded. Darlington's terraced blocks are around
//     100 x 60 m, i.e. 2.3 x 1.4 cells, so the lenient pass alone would drop
//     exactly the tight block interiors the game is most about, and would also
//     swallow every pinhole a wiggly path leaves in the middle of ground it
//     genuinely covered. The strict pass sees those; the lenient pass sees the
//     leaky ring. Neither sees both, both are sound (each awards only cells the
//     outside could not reach past cells the walker actually occupied), and the
//     union is disjoint from the input either way.
//
//  3. AWARD the original set plus the enclosed cells — and nothing else. See
//     below; this is the step with the trap in it.
//
// WHAT IS NOT AWARDED, AND WHY IT MATTERS
//
// The dilation halo is scaffolding. Dilating by one cell puts a 44 m skirt
// around every metre of every track, which on a 5 km walk is roughly 230 extra
// cells of ground nobody went near — hedges, back gardens, the other side of
// the river. Erosion removes it again from the BARRIER, but the temptation is
// to award `close(S)` rather than `S`, and that quietly pays the halo wherever
// erosion could not take it back.
//
// The BRIDGE cells — `close(S) \ S`, the punctures the closing sealed — are not
// awarded either, and that is a deliberate second decision rather than a
// consequence of the first. A bridge cell is ground the closing GUESSED was
// walked; it is a legitimate thing to reason about enclosure with and not a
// legitimate thing to be paid for. Declining to pay it costs a one-cell notch
// in the perimeter of a filled block, which the dissolve rounds off and nobody
// sees, and it keeps a hard property: every cell in the ledger was either
// physically crossed or provably surrounded. There is no third category.
//
// SO THE CAPTURED SET IS EXACTLY  S  UNION  enclosed(close(S)) .
//
// Both exclusions have their own test, because both are silent when wrong —
// the map just gets slightly too generous, in a way that looks like the feature
// working.

import { tileKeyOf, type Tile } from './tiles';

/**
 * Structuring-element radius for the morphological closing, in cells.
 *
 * One, i.e. a 3x3 square, which bridges a puncture up to TWO cells wide
 * (~88 m at z19): dilation reaches one cell from each side of the hole, and
 * erosion cannot take back what has support on both sides. That is the right
 * order of magnitude for what actually punctures a ring here — a single missed
 * Life360 poll at walking pace is ~60 m of unobserved ground, and a road
 * crossing taken at a diagonal skips one cell — and it is small enough that it
 * cannot bridge a street. Two different streets 88 m apart with nothing between
 * them is not a ring, and a radius of 2 would call it one.
 */
export const FILL_RADIUS_CELLS = 1;

/**
 * Ceiling on the interior a SINGLE journey may be paid for, in cells.
 *
 * Deliberately the same 1,000 as `maxEnclosedTiles`, the existing ring ceiling
 * (~1.97 km2 at z19 and 54.5N), and the equality is the argument rather than a
 * coincidence:
 *
 *  - It is the number the spec already defends. "A misclassified drive cannot
 *    win Darlington in one trip" is the same sentence about the same hazard,
 *    and this is the same hazard arriving by a new door — a car's cell set
 *    seals into a barrier far more reliably than its polyline closes.
 *  - A LOWER cap would make fill useless on exactly the neighbourhood-scale
 *    loops it was built for.
 *  - A HIGHER cap would be an incentive bug, not a tuning choice. A ring over
 *    1,000 cells is rejected outright, so if fill were allowed more, a journey
 *    that FAILED to close could be paid for more ground than one that closed —
 *    which inverts the entire loop/trample weighting the game rests on. The cap
 *    must be <= maxEnclosedTiles, and there is no reason for it to be less.
 *
 * Over the cap the fill is REJECTED WHOLE, not truncated. That follows the
 * ring's own precedent (`enclosedTiles` returns `overflow` and the ring is
 * rejected as 'too-many-tiles'), and truncation would be worse than either
 * alternative: it pays out an arbitrary lattice-ordered subset of a shape the
 * gate has just declared implausible. `interiorFound` is reported whether or
 * not the cap fired, so a retune can be argued from what was actually seen.
 */
export const MAX_FILL_TILES = 1000;

/**
 * Work guard, not a rule — the same 250,000 candidate cells `enclosedTiles`
 * allows, about 11 km square at z19. The flood allocates one byte per cell of
 * the padded bounding box, so this is both the memory bound and the promise
 * that the hourly heartbeat cannot hang on a data fault.
 */
export const MAX_FILL_BBOX_TILES = 250_000;

export interface FillOptions {
  radiusCells?: number;
  maxFillTiles?: number;
  maxBBoxTiles?: number;
}

export interface FillResult {
  /** The interior cells to award. Empty when the cap fired or the work guard
   *  refused the bounding box. */
  tiles: Tile[];
  /** Enclosed cells FOUND, before the cap was applied. Equal to `tiles.length`
   *  on an uncapped run, and the number a retune is argued from on a capped
   *  one. */
  interiorFound: number;
  /** The cap fired: `interiorFound` exceeded `maxFillTiles` and nothing was
   *  awarded. Recorded rather than merely acted on — a journey that trips this
   *  is either a misclassified drive or a genuinely enormous day, and both are
   *  worth being able to count. */
  capped: boolean;
  /** The bounding box was beyond the work guard; no flood was attempted. */
  bboxOverflow: boolean;
  /** |close(S)| - |S| — punctures the closing sealed. Scaffolding, never
   *  awarded. Carried so that a regression which started paying it would show
   *  up as a number rather than as a slightly generous map. */
  bridged: number;
  radiusCells: number;
  maxFillTiles: number;
}

const NEIGHBOURS_4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function keysOf(tiles: Iterable<Tile>): Set<string> {
  const out = new Set<string>();
  for (const t of tiles) {
    if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
    out.add(tileKeyOf(Math.trunc(t.x), Math.trunc(t.y)));
  }
  return out;
}

function toTiles(keys: Iterable<string>): Tile[] {
  const out: Tile[] = [];
  for (const key of keys) {
    const i = key.indexOf(':');
    out.push({ x: Number(key.slice(0, i)), y: Number(key.slice(i + 1)) });
  }
  // Sorted so the output never depends on Set insertion order — the same
  // determinism `connectedComponents` buys by sorting its keys, and the reason
  // two rebuilds of the same corpus can be diffed row by row.
  out.sort((a, b) => a.x - b.x || a.y - b.y);
  return out;
}

/**
 * Every cell within Chebyshev distance `r` of an occupied one — a (2r+1)-square
 * structuring element.
 *
 * Square rather than a plus-shape because the punctures being sealed are as
 * often diagonal as orthogonal: a walker who crosses a road at an angle leaves
 * a corner-touching pair of cells, which a plus-shaped element cannot bridge
 * and which a 4-connected flood walks straight through.
 */
export function dilateTiles(tiles: Iterable<Tile>, r = FILL_RADIUS_CELLS): Tile[] {
  const src = keysOf(tiles);
  if (r <= 0) return toTiles(src);
  const out = new Set<string>();
  for (const key of src) {
    const i = key.indexOf(':');
    const x = Number(key.slice(0, i));
    const y = Number(key.slice(i + 1));
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) out.add(tileKeyOf(x + dx, y + dy));
    }
  }
  return toTiles(out);
}

/**
 * The cells whose whole (2r+1)-square neighbourhood is occupied.
 *
 * Erosion alone is never applied to territory — it only ever appears here as
 * the second half of a closing, undoing the dilation's halo.
 */
export function erodeTiles(tiles: Iterable<Tile>, r = FILL_RADIUS_CELLS): Tile[] {
  const src = keysOf(tiles);
  if (r <= 0) return toTiles(src);
  const out = new Set<string>();
  for (const key of src) {
    const i = key.indexOf(':');
    const x = Number(key.slice(0, i));
    const y = Number(key.slice(i + 1));
    let full = true;
    for (let dx = -r; full && dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (!src.has(tileKeyOf(x + dx, y + dy))) {
          full = false;
          break;
        }
      }
    }
    if (full) out.add(key);
  }
  return toTiles(out);
}

/**
 * Morphological closing: dilate, then erode by the same element.
 *
 * Seals punctures narrower than the element while leaving everything else where
 * it was. The property the caller depends on is EXTENSIVITY — every input cell
 * is in the output, always — which holds because the square element is
 * symmetric and contains its own origin.
 */
export function closeTiles(tiles: Iterable<Tile>, r = FILL_RADIUS_CELLS): Tile[] {
  if (r <= 0) return toTiles(keysOf(tiles));
  return erodeTiles(dilateTiles(tiles, r), r);
}

interface EnclosedResult {
  tiles: Tile[];
  bboxOverflow: boolean;
}

/**
 * Empty cells the outside cannot reach.
 *
 * The flood is FOUR-connected, and that is the half of this function that is a
 * decision rather than an implementation. Foreground and background
 * connectivity have to be dual or the result is nonsense: with an 8-connected
 * background, two barrier cells meeting at a corner do not seal, so the flood
 * escapes through the diagonal and a ring walked at 45 degrees to the lattice
 * encloses nothing. Four-connected background against the 8-connected square
 * element used for the closing is the standard pairing, and it is the same
 * four-connectivity `connectedComponents` uses for the same reason.
 *
 * The grid is a flat Uint8Array over the padded bounding box rather than a Set
 * of string keys: at the work guard's limit that is 250 KB instead of ~20 MB,
 * and this runs inside an hourly job on a 7.6 GB box that earlyoom already
 * kills node on.
 */
export function enclosedCells(
  barrier: Iterable<Tile>,
  maxBBoxTiles = MAX_FILL_BBOX_TILES,
): EnclosedResult {
  const keys = keysOf(barrier);
  if (keys.size === 0) return { tiles: [], bboxOverflow: false };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const key of keys) {
    const i = key.indexOf(':');
    const x = Number(key.slice(0, i));
    const y = Number(key.slice(i + 1));
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // One cell of padding on every side, so the whole border of the working grid
  // is guaranteed background and the flood has somewhere to start.
  const x0 = minX - 1;
  const y0 = minY - 1;
  const w = maxX - minX + 3;
  const h = maxY - minY + 3;
  if (w * h > maxBBoxTiles) return { tiles: [], bboxOverflow: true };

  const EMPTY = 0;
  const BARRIER = 1;
  const OUTSIDE = 2;

  const grid = new Uint8Array(w * h);
  for (const key of keys) {
    const i = key.indexOf(':');
    const x = Number(key.slice(0, i));
    const y = Number(key.slice(i + 1));
    grid[(y - y0) * w + (x - x0)] = BARRIER;
  }

  // Seed every border cell, then flood inwards. An explicit stack rather than
  // recursion: 250,000 cells would blow the call stack.
  const stack: number[] = [];
  const push = (index: number) => {
    if (grid[index] !== EMPTY) return;
    grid[index] = OUTSIDE;
    stack.push(index);
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }

  while (stack.length) {
    const index = stack.pop()!;
    const x = index % w;
    const y = (index - x) / w;
    for (const [dx, dy] of NEIGHBOURS_4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      push(ny * w + nx);
    }
  }

  const tiles: Tile[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y * w + x] === EMPTY) tiles.push({ x: x + x0, y: y + y0 });
    }
  }
  // Row-major already gives y-then-x; re-sort to the x-then-y order every other
  // cell list in this module uses.
  tiles.sort((a, b) => a.x - b.x || a.y - b.y);
  return { tiles, bboxOverflow: false };
}

/**
 * The interior ONE CONTINUOUS RUN of observation encircled.
 *
 * The ingest does not call this directly — it calls `fillInteriorOfSegments`
 * below, which is this function per cleaned segment and is the only correct
 * unit; see the note there for the vehicle leak that unioning the segments
 * opens. This is the primitive underneath it, and the right entry point for a
 * caller that genuinely holds one uninterrupted path.
 *
 * Hand it the cells that run actually captured (its ring cells UNIONED with
 * its trampled path) and it returns the cells to award ON TOP of those. The
 * result is disjoint from the input by construction, which is what stops the
 * new `fill` event kind from paying twice for one journey: closing is
 * extensive, so every input cell is in the barrier, and the enclosed set is by
 * definition made only of cells that are NOT in the barrier.
 *
 * That disjointness is worth stating as a property rather than leaving as an
 * observation, because it is the whole answer to "does a third kind reopen the
 * farming hole Decision 10 closed". It does not: a cell this journey walked
 * cannot also be a cell this journey enclosed.
 */
export function fillInterior(tiles: Iterable<Tile>, options: FillOptions = {}): FillResult {
  const radiusCells = options.radiusCells ?? FILL_RADIUS_CELLS;
  const maxFillTiles = options.maxFillTiles ?? MAX_FILL_TILES;
  const maxBBoxTiles = options.maxBBoxTiles ?? MAX_FILL_BBOX_TILES;

  const original = keysOf(tiles);
  const empty: FillResult = {
    tiles: [],
    interiorFound: 0,
    capped: false,
    bboxOverflow: false,
    bridged: 0,
    radiusCells,
    maxFillTiles,
  };
  // Four barrier cells is the fewest that can 4-seal a single cell. Below that
  // both floods are provably empty and the allocation is wasted.
  if (original.size < 4) return empty;

  const originalTiles = toTiles(original);
  const closed = closeTiles(originalTiles, radiusCells);
  const bridged = closed.length - original.size;

  // Lenient: the leaky ring, whose puncture the closing sealed.
  const lenient = enclosedCells(closed, maxBBoxTiles);
  // Strict: holes the closing would have absorbed because they are smaller than
  // the structuring element — the tight block interior and the path's pinholes.
  const strict = enclosedCells(originalTiles, maxBBoxTiles);
  if (lenient.bboxOverflow || strict.bboxOverflow) {
    return { ...empty, bridged, bboxOverflow: true };
  }

  const union = new Set<string>();
  for (const t of lenient.tiles) union.add(tileKeyOf(t.x, t.y));
  for (const t of strict.tiles) union.add(tileKeyOf(t.x, t.y));

  const interiorFound = union.size;
  if (interiorFound > maxFillTiles) {
    return { ...empty, bridged, interiorFound, capped: true };
  }

  return {
    tiles: toTiles(union),
    interiorFound,
    capped: false,
    bboxOverflow: false,
    bridged,
    radiusCells,
    maxFillTiles,
  };
}

/**
 * The interior a journey encircled, asked SEGMENT BY SEGMENT.
 *
 * This is the entry point the ingest uses, and the segmentation is a
 * correctness requirement rather than a tidiness one.
 *
 * `cleanJourney` does not merely thin a journey, it CUTS it: a vehicle leg, a
 * leg over the 25 km/h ceiling, an excluded activity type or a hole in the
 * record all end the current run and start a new one, and its own comment says
 * why — "a dropped vehicle leg splits a journey rather than bridging it, so a
 * drive between two walks cannot draw a straight line across the county".
 *
 * A fill handed the UNION of every segment's cells undoes that. Measured, on a
 * synthetic 800 m square circuit ridden at 26-40 km/h sampled every 10-45 m:
 * the speed gate cuts it into 69-321 one-fix segments, so no leg is
 * interpolated and no ring is detected — the gates working exactly as designed
 * — and yet the surviving fix cells still form an unbroken chain of 72 cells
 * around the block, which floods into 289 interior cells. Weight 3 each: the
 * journey's score goes from 72 to 939 for ground it drove around at speed and
 * never once entered. That is the spec's Risk 1, "vehicle leakage is the one
 * fatal failure mode", arriving through a door the five existing gates do not
 * cover, because every one of them acts on the PATH and this acts on the cells
 * the path left behind.
 *
 * Per segment, the same circuit fills nothing (each segment is a single cell),
 * while a genuine wandering walk — one continuous segment — is unaffected: the
 * four-block circuit that motivated the feature awards 36 cells either way.
 *
 * The cap stays a statement about the whole JOURNEY, so it is applied to the
 * union at the end and still rejects whole rather than truncating. Two further
 * properties are enforced here that a per-segment call could not enforce alone:
 * the awarded set is subtracted against EVERY segment's cells, not just its
 * own, so ground one segment enclosed and another walked is paid once as
 * trample rather than twice; and the result stays disjoint from the outing's
 * whole captured set, which is what keeps the third `kind` clear of Decision
 * 10's farming hole.
 */
export function fillInteriorOfSegments(
  segments: ReadonlyArray<Iterable<Tile>>,
  options: FillOptions = {},
): FillResult {
  const radiusCells = options.radiusCells ?? FILL_RADIUS_CELLS;
  const maxFillTiles = options.maxFillTiles ?? MAX_FILL_TILES;
  const maxBBoxTiles = options.maxBBoxTiles ?? MAX_FILL_BBOX_TILES;

  const empty: FillResult = {
    tiles: [],
    interiorFound: 0,
    capped: false,
    bboxOverflow: false,
    bridged: 0,
    radiusCells,
    maxFillTiles,
  };

  const parts: Set<string>[] = [];
  const occupied = new Set<string>();
  for (const segment of segments) {
    const keys = keysOf(segment);
    if (keys.size === 0) continue;
    parts.push(keys);
    for (const key of keys) occupied.add(key);
  }
  if (!parts.length) return empty;

  const union = new Set<string>();
  let bridged = 0;
  let bboxOverflow = false;
  for (const part of parts) {
    // Uncapped per segment: the ceiling belongs to the journey, and capping
    // each piece separately would hand a journey the gates cut in two a double
    // allowance — the thing the old per-outing call was reaching for.
    const one = fillInterior(toTiles(part), {
      radiusCells,
      maxFillTiles: Number.POSITIVE_INFINITY,
      maxBBoxTiles,
    });
    bridged += one.bridged;
    if (one.bboxOverflow) bboxOverflow = true;
    for (const t of one.tiles) union.add(tileKeyOf(t.x, t.y));
  }
  if (bboxOverflow) return { ...empty, bridged, bboxOverflow: true };

  for (const key of occupied) union.delete(key);

  const interiorFound = union.size;
  if (interiorFound > maxFillTiles) return { ...empty, bridged, interiorFound, capped: true };

  return {
    tiles: toTiles(union),
    interiorFound,
    capped: false,
    bboxOverflow: false,
    bridged,
    radiusCells,
    maxFillTiles,
  };
}
