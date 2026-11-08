// notes-map-pencil.ts — the notes view's Wildmind map, drawn into the
// exercise book: the traced ground pencilled smooth, the three layouts the
// page can be in, the scale bar and the hand-drawn neat line round it. Where
// the words go is notes-map-words.ts.
//
// Pure and seeded, like notes-ink.ts: the same map gives the same wobble on
// the server and in the browser.
//
//  - pencilMap: the tracer's staircase rings (one cell a step) become
//    pencilled outlines. Each ring is cut at its edge midpoints (one-cell
//    stairs become diagonals), simplified (Douglas–Peucker), nudged by a
//    seeded ±0.1 of a cell and drawn as a closed smooth curve. Rings stay
//    together per layer, so even-odd holes still work. Memoised by version.
//    It runs on the server (notes-sheet.server.ts): the page gets the
//    pencilled paths, never this code.
//  - layoutsFor / mapPx: the wide, narrow and phone layouts and the map's
//    size in each, by the same sums as the page's CSS.
//  - markScale: how big the marks are drawn, so a hut or a person is the
//    same size on the page whatever the map's resolution.
//  - scaleBar: a round distance that fits under the map, in words.
//  - neatStrips: the double border as eight edge strips, so each line keeps
//    its true weight and can draw itself in.

import type { WildmindMap } from "./wildmind";
import { inkLine, rng, type Pt } from "./notes-ink";

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A short string hash (FNV-1a), for seeding the wobble from a map version. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------ pencilling */

/** The rings of a traced path (`M x y`, `h`, `v`, `Z`), as corner lists without a repeated closing corner. */
export function ringsOf(d: string): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] | null = null;
  let x = 0;
  let y = 0;
  const re = /([MhvHVLZz])\s*(-?[\d.]+)?(?:[\s,]+(-?[\d.]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const c = m[1];
    if (c === "M" || c === "L") {
      x = Number(m[2]);
      y = Number(m[3]);
      if (c === "M" || !cur) {
        cur = [[x, y]];
        out.push(cur);
      } else cur.push([x, y]);
    } else if (c === "h" || c === "H") {
      x = c === "h" ? x + Number(m[2]) : Number(m[2]);
      cur?.push([x, y]);
    } else if (c === "v" || c === "V") {
      y = c === "v" ? y + Number(m[2]) : Number(m[2]);
      cur?.push([x, y]);
    } else if (cur && cur.length > 1) {
      const a = cur[0];
      const b = cur[cur.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) cur.pop();
    }
  }
  return out.filter((r) => r.length >= 3);
}

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
};

/** Douglas–Peucker on an open run (both ends kept). */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  let far = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b);
    if (d > far) {
      far = d;
      at = i;
    }
  }
  if (far <= eps) return [a, b];
  return [
    ...simplify(pts.slice(0, at + 1), eps).slice(0, -1),
    ...simplify(pts.slice(at), eps),
  ];
}

/** Douglas–Peucker on a closed ring: split at the point farthest from the first, simplify both halves. */
export function simplifyRing(ring: Pt[], eps: number): Pt[] {
  if (ring.length < 4) return ring;
  let at = 0;
  let far = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > far) {
      far = d;
      at = i;
    }
  }
  const a = simplify(ring.slice(0, at + 1), eps);
  const b = simplify([...ring.slice(at), ring[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** The midpoint of every edge of a ring: a staircase becomes a run of diagonals. */
export const midpoints = (ring: Pt[]): Pt[] =>
  ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  });

/**
 * The same ring as a closed quadratic B-spline, in relative steps: the curve
 * runs through the midpoint of each edge with the corners as its pulls, so it
 * is smooth everywhere and costs four short numbers a point (a third of a
 * cubic through the points, which matters with the map in the page's HTML).
 */
export function quadClosed(p: Pt[]): string {
  const n = p.length;
  const mid = (i: number): Pt => [
    r1((p[i % n][0] + p[(i + 1) % n][0]) / 2),
    r1((p[i % n][1] + p[(i + 1) % n][1]) / 2),
  ];
  let [cx, cy] = mid(0);
  let d = `M${num(cx)} ${num(cy)}`;
  for (let i = 1; i <= n; i++) {
    const qx = r1(p[i % n][0]);
    const qy = r1(p[i % n][1]);
    const [mx, my] = mid(i);
    d += `q${nums([qx - cx, qy - cy, mx - cx, my - cy])}`;
    cx = mx;
    cy = my;
  }
  return `${d}z`;
}

/** A number at one decimal, as short as SVG allows: ".5", "-.5", "12". */
const num = (n: number) => {
  const s = String(r1(n) || 0);
  return s.replace(/^(-?)0\./, "$1.");
};
/** Numbers run together, a space only where a sign or a leading dot cannot separate them. */
const nums = (a: number[]) =>
  a
    .map(num)
    .reduce(
      (out, s, i) =>
        i === 0 ||
        s.startsWith("-") ||
        (s.startsWith(".") && /\.\d*$/.test(out))
          ? out + s
          : `${out} ${s}`,
      "",
    );

/** Simplification tolerance and wobble, in map cells. */
export const PENCIL_EPS = 0.7;
export const PENCIL_JITTER = 0.1;
/** Woods, marsh, sand and high ground this small (cells) are left out; ponds never are. */
export const FLECK = 2;

/** A ring's area in cells (shoelace). */
const area = (ring: Pt[]) =>
  Math.abs(
    ring.reduce(
      (a, [x, y], i) =>
        a +
        x * ring[(i + 1) % ring.length][1] -
        ring[(i + 1) % ring.length][0] * y,
      0,
    ),
  ) / 2;

/**
 * One traced path pencilled: every ring smoothed, the rings kept together for
 * even-odd holes. Rings of `minCells` or less are left out (a one-cell fleck
 * of marsh is noise at this size, and bytes in the page).
 */
export function pencilPath(d: string, seed: number, minCells = 0): string {
  return ringsOf(d)
    .map((ring, k) => {
      if (minCells && area(ring) <= minCells) return "";
      const mids = midpoints(ring);
      let pts = simplifyRing(mids, PENCIL_EPS);
      if (pts.length < 4) pts = mids;
      const r = rng(seed + k * 7);
      return quadClosed(
        pts.map(
          ([x, y]) =>
            [
              x + (r() * 2 - 1) * PENCIL_JITTER,
              y + (r() * 2 - 1) * PENCIL_JITTER,
            ] as Pt,
        ),
      );
    })
    .join("");
}

const memo = new Map<string, WildmindMap>();

/**
 * The map with its ground pencilled (seen, and every layer but open ground,
 * which is the seen ground's own colour); relief is not drawn in this view. Memoised by version (the last two kept), so a poll that
 * brings the same map back costs nothing.
 */
export function pencilMap(map: WildmindMap): WildmindMap {
  const hit = memo.get(map.version);
  if (hit && hit.w === map.w && hit.h === map.h) return hit;
  const base = hash(map.version);
  const out: WildmindMap = {
    ...map,
    seen: pencilPath(map.seen, base),
    // Open ground is coloured the same as the seen ground under it, so it isn't drawn twice (a quarter of the map's bytes).
    layers: map.layers.flatMap((l, i) =>
      l.cls === "open"
        ? []
        : [
            {
              cls: l.cls,
              d: pencilPath(
                l.d,
                base + (i + 1) * 101,
                l.cls === "fresh" ? 0 : FLECK,
              ),
            },
          ],
    ),
    relief: null,
  };
  memo.set(map.version, out);
  while (memo.size > 2) memo.delete(memo.keys().next().value as string);
  return out;
}

/* -------------------------------------------------------------- layouts */

/** A map at least this much wider than tall is turned a quarter on a phone. */
export const TURN_AT = 1.2;
export type LayoutKey = "w" | "n" | "t";
export const LAYOUT_KEYS: readonly LayoutKey[] = ["w", "n", "t"];

export interface Layout {
  key: LayoutKey;
  /** The page's body column at the narrowest width this layout covers (px). */
  body: number;
  phone: boolean;
  turned: boolean;
  /** Tag and place-name type sizes (px). */
  tagPx: number;
  placePx: number;
  /** The most place names written. */
  max: number;
}

/**
 * The body column at its narrowest in each layout: wide from 1280px (1,038px
 * there, 1,004px on a very wide screen, where the margin and gutters reach
 * their caps), narrow from 761px, the phone from 360px. The page's CSS switches at the same widths (WIDE_MIN).
 */
export const BODY = { w: 1004, n: 600, t: 284 } as const;
export const WIDE_MIN = 1280;
const INSET = 20;
const RULE = 32;
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

export function layoutsFor(map: Pick<WildmindMap, "w" | "h">): Layout[] {
  const turned = map.w / map.h >= TURN_AT;
  return [
    {
      key: "w",
      body: BODY.w,
      phone: false,
      turned: false,
      tagPx: 17,
      placePx: 15,
      max: 6,
    },
    {
      key: "n",
      body: BODY.n,
      phone: false,
      turned: false,
      tagPx: 17,
      placePx: 13,
      max: 3,
    },
    {
      key: "t",
      body: BODY.t,
      phone: true,
      turned,
      tagPx: 16,
      placePx: 13,
      max: 3,
    },
  ];
}

/**
 * The drawn map's size in pixels for a body width, by the same sums as the
 * page's CSS: `mw` along the map's x, `mh` along its y (turned, mw runs down
 * the page), and the frame's height.
 */
export function mapPx(
  map: Pick<WildmindMap, "w" | "h">,
  body: number,
  phone: boolean,
  turned: boolean,
): { mw: number; mh: number; fh: number } {
  const asp = map.w / map.h;
  const across = body - INSET;
  let fh: number;
  let mw: number;
  if (!phone) {
    fh = clamp(Math.floor(body / asp / RULE) * RULE, 384, 672);
    mw = Math.min(across, (fh - INSET) * asp);
  } else if (turned) {
    fh = clamp(Math.round((across * asp + INSET) / RULE) * RULE, 384, 544);
    mw = Math.min(fh - INSET, across * asp);
  } else {
    fh = clamp(Math.round((across / asp + INSET) / RULE) * RULE, 288, 544);
    mw = Math.min(across, (fh - INSET) * asp);
  }
  return { mw, mh: mw / asp, fh };
}

/**
 * The day-16 map the marks were drawn for, laid out wide: 141 units across
 * 940 pixels. Marks (people, huts, animals, the pencil patterns) are sized in
 * map units times markScale, so on the page they keep that size whatever the
 * map's resolution: a valley traced at 164 cells across, or 192 at two tiles
 * a cell, draws its huts no bigger and no smaller than the day-16 one did.
 */
export const MARK_PX_PER_UNIT = 940 / 141;

/** Map units per "design unit" of a mark: 1 for the day-16 map, under 1 for a coarser one drawn smaller. */
export function markScale(map: Pick<WildmindMap, "w" | "h">): number {
  const { mw } = mapPx(map, BODY.w, false, false);
  const ppu = mw / Math.max(1, map.w);
  return Math.round((MARK_PX_PER_UNIT / Math.max(0.01, ppu)) * 1000) / 1000;
}

/* ------------------------------------------------------------ scale bar */

const STEPS = [
  { m: 50, words: "fifty metres" },
  { m: 100, words: "a hundred metres" },
  { m: 200, words: "two hundred metres" },
  { m: 500, words: "half a kilometre" },
  { m: 1000, words: "a kilometre" },
] as const;

/** A round distance as a share `k` of the map's width it is drawn across, in words. */
function barFor(
  across: number,
  metresPerUnit: number,
): { k: number; words: string } {
  let i = 1;
  const k = (j: number) => STEPS[j].m / metresPerUnit / across;
  while (i > 0 && k(i) > 0.45) i--;
  while (i < STEPS.length - 1 && k(i) < 0.12) i++;
  return { k: Math.round(k(i) * 10_000) / 10_000, words: STEPS[i].words };
}

/** The scale bar for the map lying flat (across its x) and turned on a phone (across its y). */
export function scaleBar(map: Pick<WildmindMap, "w" | "h" | "metresPerUnit">): {
  wide: { k: number; words: string };
  turned: { k: number; words: string };
} {
  return {
    wide: barFor(map.w, map.metresPerUnit),
    turned: barFor(map.h, map.metresPerUnit),
  };
}

/* ------------------------------------------------------------ neat line */

/**
 * The double neat line: four edge strips a box (outer, then inner), each one
 * hand-drawn stroke end to end. Top and bottom are drawn in a 1000×8 box,
 * left and right in 8×1000, each stretched only along its length.
 */
export function neatStrips(
  seed = 611,
): Array<{
  box: "outer" | "inner";
  edge: "top" | "right" | "bottom" | "left";
  d: string;
}> {
  const edges = ["top", "right", "bottom", "left"] as const;
  return (["outer", "inner"] as const).flatMap((box, b) =>
    edges.map((edge, i) => {
      const r = rng(seed + b * 4 + i);
      const flat = edge === "top" || edge === "bottom";
      return {
        box,
        edge,
        d: flat
          ? inkLine(r, 0, 4, 1000, 4, 0.5, 0.0012)
          : inkLine(r, 4, 0, 4, 1000, 0.5, 0.0012),
      };
    }),
  );
}
