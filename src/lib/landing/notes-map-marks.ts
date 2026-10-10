// notes-map-marks.ts — the notes view's Wildmind map, the huts: those that
// stand close together are drawn as one camp, a smooth pencilled fence round
// the lot with each hut a small square inside it, so forty shelters read as
// a settlement rather than a scatter of squares (or, as a union of discs
// did, a cloud).
//
// Pure, like notes-map-pencil.ts: the same snapshot gives the same camps
// every time. It runs on the server (notes-sheet.server.ts); the page gets
// the fences as one path.

import type { StructureClass } from "./wildmind";
import { rng, type Pt } from "./notes-ink";
import { quadClosed } from "./notes-map-pencil";

type Structure = [number, number, 0 | 1, 0 | 1, StructureClass];

/** Huts closer than this (metres) belong to one camp. */
export const CAMP_GAP_M = 6.4;
/** A camp is at least this many huts; fewer are drawn as huts. */
export const CAMP_MIN = 3;
/** How far the fence stands off the outermost huts (map units at markScale 1). */
export const CAMP_PAD = 1.8;
/** The pencil's wobble on the fence, either way (map units at markScale 1). */
export const CAMP_JITTER = 0.15;

/**
 * Huts grouped: any run of huts each within CAMP_GAP_M of the next is one
 * group, and a group of CAMP_MIN or more is a camp. The rest stay huts.
 * `metresPerUnit` is the map's (two for a map one tile a unit).
 */
export function camps(structures: Structure[], metresPerUnit = 2): {
  camps: Pt[][];
  huts: Structure[];
} {
  const n = structures.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (
        Math.hypot(
          structures[i][0] - structures[j][0],
          structures[i][1] - structures[j][1],
        ) <= CAMP_GAP_M / metresPerUnit
      )
        parent[find(i)] = find(j);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const g = find(i);
    groups.set(g, [...(groups.get(g) ?? []), i]);
  }
  const out: Pt[][] = [];
  const huts: Structure[] = [];
  for (const members of groups.values()) {
    if (members.length >= CAMP_MIN)
      out.push(members.map((i) => [structures[i][0], structures[i][1]] as Pt));
    else huts.push(...members.map((i) => structures[i]));
  }
  return { camps: out, huts };
}

const cross = (o: Pt, a: Pt, b: Pt) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** The convex hull of some points, anticlockwise from the lowest-left (monotone chain). */
export function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lower: Pt[] = [];
  for (const q of p) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0
    )
      lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0
    )
      upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * A camp's fence as corner points: the hull of every hut grown by `pad`
 * (eight points round each hut), with corners closer than a unit merged (a
 * unit at the standard pad, scaled with it), so the curve through them is
 * round at the ends and straight along the sides.
 */
export function campRing(huts: Pt[], pad = CAMP_PAD): Pt[] {
  const merge = pad / CAMP_PAD;
  const grown = huts.flatMap(([x, y]) =>
    Array.from(
      { length: 8 },
      (_, k) =>
        [
          x + pad * Math.cos((k * Math.PI) / 4),
          y + pad * Math.sin((k * Math.PI) / 4),
        ] as Pt,
    ),
  );
  const ring = hull(grown);
  const out: Pt[] = [];
  for (const q of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) >= merge) out.push(q);
  }
  if (
    out.length > 3 &&
    Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < merge
  )
    out.pop();
  return out;
}

/**
 * A camp's fence, pencilled: the ring smoothed (a closed curve through it, as
 * the ground is drawn) with a seeded wobble, so the same camp is drawn the
 * same on the server and in the browser. One closed path a camp.
 */
export function campPath(huts: Pt[], seed = 701, mark = 1): string {
  const r = rng(
    seed + Math.round(huts[0]?.[0] ?? 0) * 31 + Math.round(huts[0]?.[1] ?? 0),
  );
  // The fence's offset and wobble are drawn sizes, so they follow markScale.
  const ring = campRing(huts, CAMP_PAD * mark).map(
    ([x, y]) =>
      [
        x + (r() * 2 - 1) * CAMP_JITTER * mark,
        y + (r() * 2 - 1) * CAMP_JITTER * mark,
      ] as Pt,
  );
  return ring.length >= 3 ? quadClosed(ring) : "";
}
