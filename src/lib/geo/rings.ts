// Planar ring primitives, in METRES.
//
// SERVER-ONLY. Nothing under src/lib/geo may be imported by a client component:
// a claim ring's vertices are real GPS fixes for five people, three of them
// children, and the page ships dissolved territory rings only.
//
// Everything here works on a flat plane. That is legitimate because callers
// project into local metres first (see tiles.ts `localProjection`), and every
// shape this file ever sees is at most a couple of kilometres across — the
// error from ignoring the Earth's curvature over 2 km is under a centimetre,
// which is four orders of magnitude below GPS noise. Doing it this way is what
// lets the whole feature ship with no geometry library: PostGIS is not
// installed on the app DB, and turf/jsts are out of scope.
//
// A ring is an implicitly-closed array of vertices: the segment from the last
// vertex back to the first is real and is never stored.

export type Vec2 = [x: number, y: number];

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Twice-the-shoelace, halved — signed, so the sign carries the winding
 * direction. Positive is counter-clockwise in a y-up frame.
 */
export function signedArea(ring: Vec2[]): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return -sum / 2;
}

/** Unsigned area in square metres. */
export function ringArea(ring: Vec2[]): number {
  return Math.abs(signedArea(ring));
}

/** Length of the closed boundary — includes the last-to-first segment. */
export function ringPerimeter(ring: Vec2[]): number {
  if (ring.length < 2) return 0;
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
  }
  return sum;
}

/** Length of an OPEN path — no closing segment. */
export function pathLength(points: Vec2[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return sum;
}

/**
 * Ray casting, NONZERO WINDING.
 *
 * This used to be even-odd, with a comment claiming that a winding rule would
 * cancel the two lobes of a one-stroke figure-of-eight. That reasoning does not
 * survive being run, and the file's own `signedArea` is where the confusion came
 * from: it is the shoelace AREA that cancels opposite-wound lobes, and area is a
 * different computation from a point's winding number. A point is only ever
 * inside ONE lobe at a time, so its winding number there is +1 or -1 — never
 * zero. Both lobes are kept, which is the spec's "enclosed tiles are unioned so
 * winding signs cannot cancel".
 *
 * What even-odd got wrong, and winding gets right, is a ring wound more than
 * once. Two laps of the same block, retraced closely enough that the strands
 * never cross transversally, arrive here as a single doubly-wound ring; even-odd
 * counted two crossings for every interior point and reported the whole block
 * OUTSIDE. Capture flipped on the PARITY of the lap count — one lap and three
 * laps scored, two and four and ten scored nothing. In the wild GPS wander
 * usually makes the laps cross, which pops them apart before they reach this
 * function, so the failure was hidden behind luck rather than prevented by
 * design; an exactly-retraced route, a map-matched one, or a sparse pair of
 * Life360 laps that happen not to cross got nothing.
 *
 * The two rules agree on every simple ring, so this is strictly the safer one.
 *
 * The crossing test is the same half-open rule as before, now signed: an edge
 * counts when it spans the ray from below-inclusive to above-exclusive, so a
 * vertex sitting exactly on the ray is counted once, not twice or zero times.
 * `side` is twice the signed triangle area, i.e. which way the edge crosses.
 */
export function pointInRing(p: Vec2, ring: Vec2[]): boolean {
  return windingNumber(p, ring) !== 0;
}

/**
 * How many times the ring wraps anticlockwise around the point. Zero is
 * outside; +/-1 is a normal enclosure; +/-N is N laps of the same ground.
 *
 * The magnitude is what makes the shoelace usable on a repeated route: a ring
 * walked three times has three times the signed area of the ground it covers,
 * so the honest area of the ring is the shoelace divided by this.
 */
export function windingNumber(p: Vec2, ring: Vec2[]): number {
  if (ring.length < 3) return 0;
  const [px, py] = p;
  let winding = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // Edge j -> i. `side` > 0 means p is left of it.
    const side = (xi - xj) * (py - yj) - (px - xj) * (yi - yj);
    if (yj <= py) {
      if (yi > py && side > 0) winding++;
    } else if (yi <= py && side < 0) {
      winding--;
    }
  }
  return winding;
}

/**
 * Does this ring cross itself?
 *
 * The closing last-to-first segment is part of the ring, so it is tested too.
 * Callers care because the shoelace is only an honest area for a SIMPLE ring:
 * on a self-crossing one the opposite-wound lobes subtract from each other, and
 * the number that comes out is smaller than the ground the ring actually covers.
 */
export function isSimpleRing(ring: Vec2[]): boolean {
  if (ring.length < 4) return true;
  const closed = [...ring, ring[0]];
  for (let i = 0; i < closed.length - 1; i++) {
    for (let j = i + 2; j < closed.length - 1; j++) {
      if (segmentIntersection(closed[i], closed[i + 1], closed[j], closed[j + 1])) return false;
    }
  }
  return true;
}

export function bboxOf(points: Vec2[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/**
 * Relative tolerance for "is the crossing strictly inside both segments".
 * Expressed as a fraction of each segment's own parameter range, so it means
 * the same thing for a 5 m leg and a 500 m one.
 */
const CROSS_EPS = 1e-9;

/**
 * Where two segments PROPERLY cross, or null.
 *
 * Proper means transversal and strictly interior to both. Three cases are
 * deliberately not intersections:
 *
 *  - parallel or collinear, however much they overlap. A retraced out-and-back
 *    leg is collinear with its outbound leg, and calling that a self-crossing
 *    would turn every there-and-back walk into a zero-area "loop".
 *  - a shared endpoint. Consecutive legs of a track touch at every single
 *    vertex; counting those would make every journey self-intersecting.
 *  - a crossing that lies beyond either segment's ends.
 */
export function segmentIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const rx = a2[0] - a1[0];
  const ry = a2[1] - a1[1];
  const sx = b2[0] - b1[0];
  const sy = b2[1] - b1[1];

  const denom = rx * sy - ry * sx;
  if (denom === 0) return null; // parallel or collinear

  const qpx = b1[0] - a1[0];
  const qpy = b1[1] - a1[1];
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;

  if (t <= CROSS_EPS || t >= 1 - CROSS_EPS) return null;
  if (u <= CROSS_EPS || u >= 1 - CROSS_EPS) return null;

  return [a1[0] + t * rx, a1[1] + t * ry];
}
