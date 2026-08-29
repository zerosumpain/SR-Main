// Owned cells -> painted ground.
//
// SERVER-ONLY (see rings.ts).
//
// The grid is a scoring device and is never shown. This is the module that
// hides it: a person's owned cells are grouped into connected components, the
// boundary of each is traced once, and two Chaikin passes round the corners off
// so territory reads as organic painted ground rather than as Minecraft.
//
// It is also the payload budget. Shipping per-cell geometry to the client would
// mean roughly twelve thousand features on the SVG renderer, which crawls;
// after the dissolve the same territory is tens of rings. Every consumer takes
// this output, never the cell set.
//
// The trace works on the CORNER LATTICE, not on cell centres. Cell (x, y) has
// corners (x, y) north-west through (x+1, y+1) south-east, so a boundary edge
// is a unit step between two integer corners and rings stitch together exactly,
// with no floating-point endpoint matching to get wrong.

import { tileCorner, tileKeyOf, TILE_ZOOM, type Tile } from './tiles';
import { signedArea, type Vec2 } from './rings';

/** Rounding passes. Two is the spec's; a third costs vertices and adds nothing
 *  a viewer can see at map zooms. */
export const CHAIKIN_PASSES = 2;

export interface DissolvedRegion {
  /** Cells in this component — the leaderboard's area is this times the
   *  per-latitude cell constant, not the ring's shoelace area. */
  tileCount: number;
  /** Outer boundary as [lon, lat]. */
  outer: Array<[number, number]>;
  /** Enclosed holes as [lon, lat] — this is Katie's block walk punched through
   *  the middle of John's loop. */
  holes: Array<Array<[number, number]>>;
}

/**
 * Four-connected components.
 *
 * Four rather than eight on purpose: two cells touching only at a corner are
 * not one piece of ground, and treating them as one would let a single diagonal
 * line of trample cells weld a whole town into one blob whose outline means
 * nothing.
 */
export function connectedComponents(tiles: Iterable<Tile>): Tile[][] {
  const remaining = new Map<string, Tile>();
  for (const t of tiles) remaining.set(tileKeyOf(t.x, t.y), t);

  // Sorted so the output does not depend on insertion order.
  const keys = [...remaining.keys()].sort();
  const seen = new Set<string>();
  const out: Tile[][] = [];

  for (const start of keys) {
    if (seen.has(start)) continue;
    const component: Tile[] = [];
    const stack = [start];
    seen.add(start);

    while (stack.length) {
      const key = stack.pop()!;
      const tile = remaining.get(key)!;
      component.push(tile);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nk = tileKeyOf(tile.x + dx, tile.y + dy);
        if (remaining.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    out.push(component);
  }

  return out;
}

type Corner = [number, number];
const cornerKey = (c: Corner) => `${c[0]},${c[1]}`;

/**
 * Trace the boundary of one component into closed corner rings.
 *
 * Every cell contributes a directed unit edge for each of its four neighbours
 * that is not in the set, wound so the OWNED side is always on the same hand.
 * Because every edge is consistently wound, the outer boundary and any holes
 * come out turning opposite ways, which is exactly what an SVG nonzero fill
 * needs to show a hole rather than paint over it.
 */
function traceRings(component: Tile[]): Corner[][] {
  const owned = new Set(component.map((t) => tileKeyOf(t.x, t.y)));
  const has = (x: number, y: number) => owned.has(tileKeyOf(x, y));

  // start corner -> end corners still to be walked
  const outgoing = new Map<string, Corner[]>();
  const addEdge = (from: Corner, to: Corner) => {
    const list = outgoing.get(cornerKey(from));
    if (list) list.push(to);
    else outgoing.set(cornerKey(from), [to]);
  };

  for (const { x, y } of component) {
    if (!has(x, y - 1)) addEdge([x, y], [x + 1, y]); // north edge, running east
    if (!has(x + 1, y)) addEdge([x + 1, y], [x + 1, y + 1]); // east, running south
    if (!has(x, y + 1)) addEdge([x + 1, y + 1], [x, y + 1]); // south, running west
    if (!has(x - 1, y)) addEdge([x, y + 1], [x, y]); // west, running north
  }

  const rings: Corner[][] = [];

  while (outgoing.size) {
    const startKey = [...outgoing.keys()][0];
    const [sx, sy] = startKey.split(',').map(Number);
    const start: Corner = [sx, sy];

    const ring: Corner[] = [start];
    let at = start;
    let heading: Vec2 = [0, 0];

    // Bounded: each step consumes one edge, and the edge count is finite.
    for (;;) {
      const list = outgoing.get(cornerKey(at));
      if (!list || !list.length) break;

      let index = 0;
      if (list.length > 1 && (heading[0] || heading[1])) {
        // Sharpest right turn first. A corner can only offer two exits when the
        // owned cells around it meet diagonally, and that pattern is two
        // 4-connected components, so this cannot fire on input from
        // `connectedComponents`. It is here so the tracer is correct on any
        // cell set, rather than correct only because of how it is called.
        let best = -Infinity;
        list.forEach((candidate, i) => {
          const dx = candidate[0] - at[0];
          const dy = candidate[1] - at[1];
          const cross = heading[0] * dy - heading[1] * dx;
          const dot = heading[0] * dx + heading[1] * dy;
          // Rank: right turn, then straight on, then left, then reverse.
          const score = cross < 0 ? 3 : dot > 0 ? 2 : cross > 0 ? 1 : 0;
          if (score > best) {
            best = score;
            index = i;
          }
        });
      }

      const next = list.splice(index, 1)[0];
      if (!list.length) outgoing.delete(cornerKey(at));

      heading = [next[0] - at[0], next[1] - at[1]];
      at = next;
      if (at[0] === start[0] && at[1] === start[1]) break;
      ring.push(at);
    }

    if (ring.length >= 4) rings.push(ring);
  }

  return rings;
}

/** Drop the middle of any run of three collinear corners. A 10x10 block is four
 *  corners, not forty. */
function collapseCollinear(ring: Corner[]): Corner[] {
  if (ring.length < 3) return ring;
  const out: Corner[] = [];
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length];
    const cur = ring[i];
    const next = ring[(i + 1) % ring.length];
    const cross =
      (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    if (cross !== 0) out.push(cur);
  }
  return out.length >= 3 ? out : ring;
}

/**
 * Chaikin corner cutting on a CLOSED ring: each edge is replaced by its quarter
 * and three-quarter points, so one pass doubles the vertex count and the result
 * is strictly inside the original.
 *
 * Two passes is enough for territory to stop looking like graph paper while the
 * shape still visibly follows the streets somebody walked. It is deliberately
 * not a spline: Chaikin cannot overshoot outside the hull, so smoothed
 * territory can never claim ground the cells did not.
 */
export function chaikin(ring: Vec2[], passes = CHAIKIN_PASSES): Vec2[] {
  let current = ring;
  for (let pass = 0; pass < passes; pass++) {
    if (current.length < 3) return current;
    const next: Vec2[] = [];
    for (let i = 0; i < current.length; i++) {
      const a = current[i];
      const b = current[(i + 1) % current.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    current = next;
  }
  return current;
}

export interface DissolveOptions {
  zoom?: number;
  chaikinPasses?: number;
}

/**
 * One person's owned cells -> the rings the page actually draws.
 *
 * Smoothing happens in LATTICE space and the result is projected to lat/lon
 * afterwards, so the quarter-points are computed on a square grid rather than
 * on degrees, where a corner would be rounded 1.7 times harder in longitude
 * than in latitude at this latitude and every curve would come out squashed.
 */
export function dissolveTiles(
  tiles: Iterable<Tile>,
  options: DissolveOptions = {},
): DissolvedRegion[] {
  const zoom = options.zoom ?? TILE_ZOOM;
  const passes = options.chaikinPasses ?? CHAIKIN_PASSES;

  const regions: DissolvedRegion[] = [];

  for (const component of connectedComponents(tiles)) {
    const rings = traceRings(component).map(collapseCollinear);
    if (!rings.length) continue;

    const toLonLat = (ring: Corner[]): Array<[number, number]> =>
      chaikin(ring as Vec2[], passes).map((c) => {
        const ll = tileCorner(c[0], c[1], zoom);
        return [ll.lon, ll.lat];
      });

    // Holes are strictly inside the outer boundary, so the largest ring by
    // absolute area is the outer one. Absolute rather than signed: the two do
    // wind opposite ways, but keying on the sign would silently invert the
    // whole output if the lattice's north-edge direction were ever flipped,
    // and "biggest" cannot.
    let outerRing = rings[0];
    let outerArea = -Infinity;
    for (const ring of rings) {
      const area = Math.abs(signedArea(ring as Vec2[]));
      if (area > outerArea) {
        outerArea = area;
        outerRing = ring;
      }
    }

    regions.push({
      tileCount: component.length,
      outer: toLonLat(outerRing),
      holes: rings.filter((r) => r !== outerRing).map(toLonLat),
    });
  }

  return regions;
}
