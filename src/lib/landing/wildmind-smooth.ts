// wildmind-smooth.ts — the tracer's staircase rings drawn as an engraver
// would: smooth coasts and woods instead of a bitmap's two-metre steps.
//
// The server traces seen terrain into `M x y h… v… z` rings (one cell a step,
// see wildmind-trace.server.ts) and every view gets that shape; the notes view
// pencils it with its own wobble. A view that wants clean engraved lines (the
// sentence plate now, the place view later) passes the map through here:
//
//  - Specks go: a ring smaller than `minArea` cells is dropped (an island of
//    one class, or a hole of another inside it), and a hole in the seen land
//    smaller than `minHole` is filled, so the land is not peppered with
//    outlined dots.
//  - Each ring is cut at its edge midpoints (a one-cell staircase becomes a
//    diagonal), points in a straight line are merged, each point is relaxed
//    halfway towards its neighbours (one-cell teeth round off), and it is drawn
//    as quadratic curves through the midpoints of what is left, with the
//    corners as control points. Neighbouring classes share their boundary
//    vertex for vertex, so their smoothed edges still meet (they can only
//    differ by a hair where three classes meet).
//  - `edge` is the outer rim of the seen land alone (no holes), for a view
//    that strokes only the coast of what is known, not every gap inside it.
//
// Pure and deterministic (the server and the browser draw the same), and
// memoised for the last two map versions.

import type { WildmindMap } from './wildmind';

type Pt = [number, number];

export interface SmoothOptions {
  /** Rings smaller than this many cells are dropped. */
  minArea?: number;
  /** Holes in the seen land smaller than this many cells are filled. */
  minHole?: number;
}

export interface SmoothedMap extends WildmindMap {
  /** The seen land's outer rim only (holes left out), for a stroke. */
  edge: string;
}

/** The rings of a staircase path (`M x y`, `h`, `v`, `z`), each as its corners. */
export function staircaseRings(d: string): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] | null = null;
  let x = 0;
  let y = 0;
  const re = /([MhvHVLlZz])\s*(-?[\d.]+)?(?:[\s,]+(-?[\d.]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const c = m[1];
    if (c === 'M') {
      x = Number(m[2]);
      y = Number(m[3]);
      cur = [[x, y]];
      out.push(cur);
    } else if (c === 'L' || c === 'l') {
      x = c === 'L' ? Number(m[2]) : x + Number(m[2]);
      y = c === 'L' ? Number(m[3]) : y + Number(m[3]);
      cur?.push([x, y]);
    } else if (c === 'h' || c === 'H') {
      x = c === 'h' ? x + Number(m[2]) : Number(m[2]);
      cur?.push([x, y]);
    } else if (c === 'v' || c === 'V') {
      y = c === 'v' ? y + Number(m[2]) : Number(m[2]);
      cur?.push([x, y]);
    } else if (cur && cur.length > 1) {
      const a = cur[0];
      const b = cur[cur.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) cur.pop();
      cur = null;
    }
  }
  return out.filter((r) => r.length >= 3);
}

/** Signed area in cells: positive for an outer ring (clockwise on screen, as the tracer writes them), negative for a hole. */
export function ringArea(r: Pt[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [ax, ay] = r[i];
    const [bx, by] = r[(i + 1) % r.length];
    s += ax * by - bx * ay;
  }
  return s / 2;
}

const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** One pass of relaxation: each point pulled halfway to its neighbours' middle, so one-cell teeth round off. */
function relax(p: Pt[]): Pt[] {
  return p.map((q, i) => {
    const a = p[(i - 1 + p.length) % p.length];
    const b = p[(i + 1) % p.length];
    return [q[0] / 2 + (a[0] + b[0]) / 4, q[1] / 2 + (a[1] + b[1]) / 4];
  });
}

/** Points within this distance (cells) of the line through their neighbours are merged. */
const FLAT = 0.1;

/** Edge midpoints, relaxed once, then points (nearly) in a straight line merged. */
function cut(r: Pt[]): Pt[] {
  const m = relax(r.map((p, i) => mid(p, r[(i + 1) % r.length])));
  const out: Pt[] = [];
  for (let i = 0; i < m.length; i++) {
    const a = out.length ? out[out.length - 1] : m[(i - 1 + m.length) % m.length];
    const p = m[i];
    const b = m[(i + 1) % m.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const off = len > 1e-9 ? Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / len : 0;
    if (off > FLAT) out.push(p);
  }
  return out.length >= 3 ? out : m;
}

/** Tenths of a cell: under a pixel on any plate this site draws. */
const t1 = (n: number) => Math.round(n * 10);
const f1 = (n: number) => String(n / 10).replace(/^(-?)0\./, '$1.');

/**
 * One ring as a closed run of quadratic curves through its edge midpoints,
 * in relative commands on a tenth-of-a-cell grid (each step measured from the
 * rounded point before, so nothing drifts).
 */
export function curveRing(r: Pt[]): string {
  const p = cut(r);
  const start = mid(p[p.length - 1], p[0]);
  let x = t1(start[0]);
  let y = t1(start[1]);
  let s = `M${f1(x)} ${f1(y)}`;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    const e = mid(c, p[(i + 1) % p.length]);
    const cx = t1(c[0]);
    const cy = t1(c[1]);
    const ex = t1(e[0]);
    const ey = t1(e[1]);
    s += `q${f1(cx - x)} ${f1(cy - y)} ${f1(ex - x)} ${f1(ey - y)}`;
    x = ex;
    y = ey;
  }
  return `${s}z`;
}

/** A staircase path smoothed, rings under `minArea` dropped and holes under `minHole` filled. */
export function smoothPath(d: string, minArea = 4, minHole = minArea, outerOnly = false): string {
  let out = '';
  for (const r of staircaseRings(d)) {
    const a = ringArea(r);
    if (a > 0 ? a < minArea : -a < minHole || outerOnly) continue;
    out += curveRing(r);
  }
  return out;
}

const memo = new Map<string, SmoothedMap>();

/** A traced map with every path smoothed (see the top of this file). Memoised by version and options. */
export function smoothMap(map: WildmindMap, opts: SmoothOptions = {}): SmoothedMap {
  const minArea = opts.minArea ?? 4;
  const minHole = opts.minHole ?? 12;
  const key = `${map.version}|${map.w}|${map.h}|${minArea}|${minHole}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const out: SmoothedMap = {
    ...map,
    seen: smoothPath(map.seen, minArea, minHole),
    edge: smoothPath(map.seen, minArea, minHole, true),
    layers: map.layers.map((l) => ({ cls: l.cls, d: smoothPath(l.d, minArea) })).filter((l) => l.d),
    relief: map.relief ? smoothPath(map.relief, minArea) || null : null,
  };
  memo.set(key, out);
  while (memo.size > 2) memo.delete(memo.keys().next().value as string);
  return out;
}
