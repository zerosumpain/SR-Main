// wildmind-glass.server.ts — Wildmind's seen terrain as a planning model, for
// the place view's gallery window (wildmind-glass.ts has the shape, and why).
//
// From the public snapshot's height grid (round((h + 2) × 10) a byte, unseen
// cells zeroed) the model is built as a stack of cards: the lowest is
// everything seen and is painted as water, then one card at sea level and one
// for every metre and a half and up above it. Each card's outline comes from
// marching squares over min(height − threshold, seen), so every card is
// already clipped to the edge of the known (where exploration stops the
// model ends in a clean cut, its strata showing) and each card sits inside
// the one below it. The rings are simplified (Ramer–Douglas–Peucker), drawn
// as quadratic curves through their edges' midpoints, and tilted toward the
// street (TILT) on the server, so the page only translates each one up by its
// lift. Wooded cells grow lichen trees and marshy ones marsh marks, on the
// card they stand on. A run-length grid says which card every cell stands
// on, so the page can stand a person, a hut or an animal on the right card
// as they move.
//
// Caps: the grid is at most MAX_GLASS_ACROSS cells across (wider valleys are
// averaged in blocks), the outlines at most MAX_POINTS points in all (past
// it they are simplified harder and specks dropped, then traced again), the
// trees at most MAX_TREES, the cards at most MAX_CARDS. Every cell stands on
// the highest card whose kept outline holds it, and a top card left with no
// outline is not sent. On the day-16 fixture that is six cards, some nine
// hundred outline points and as many trees: about twenty-four KB raw, seven
// gzipped (the live valley about twenty and seven), the trees about half of
// it, sent only when the drawn terrain version changes (wildmind.server.ts
// holds one while the valley only grows). Server only; the last two versions
// are cached.

import { BOARD, TILT, encodeBands, type GlassCard, type WildmindGlass } from './wildmind-glass';
import type { WildmindTerrain } from './wildmind';

/** The widest grid the model is built from, in cells; a wider valley is averaged in blocks. */
export const MAX_GLASS_ACROSS = 160;
/** The most outline points all the cards may have together. */
export const MAX_POINTS = 3200;
/** The most trees on the model. */
export const MAX_TREES = 900;
/** The most cards: the water card, sea level, and up to seven above it. */
export const MAX_CARDS = 9;
/** The most board units a cell may take, so a young valley sits small on a bare board. */
export const MAX_CELL = 7;
/** The first card's height above the board, and the highest any card may stand. */
export const BASE_LIFT = 2.4;
export const MAX_LIFT = 36;
/** The lowest height a byte can say (round((h + 2) × 10)): the water card stands for it. */
const FLOOR_M = -2;
/** The first step above sea level, and the step after it, in metres. */
const FIRST_STEP = 1.5;
/** Simplification tried in turn past the point cap: RDP tolerance and the smallest ring kept, in cells. */
const PASSES: Array<[eps: number, minArea: number]> = [
  [0.28, 1.2],
  [0.45, 2.5],
  [0.7, 5],
  [1.1, 10],
  [1.8, 24],
];
/** An unseen cell's value in every card's field: far below any edge, so every card's cut lands at the same place. */
const UNSEEN = -20;

const WATER = new Set(['deep_sea', 'shallow_sea', 'deep_fresh', 'shallow_fresh']);
const WOOD = new Set(['forest', 'jungle']);
const WET = new Set(['marsh']);

const r1 = (n: number) => Math.round(n * 10) / 10;
/** A number as short as SVG allows: one decimal, no leading nought ("-.4"). */
const num = (n: number) => String(r1(n) || 0).replace(/^(-?)0\./, '$1.');
/** Numbers joined as SVG reads them: a space only where the next doesn't start with a sign or a point it can split at. */
function nums(...ns: number[]): string {
  let out = '';
  for (const n of ns) {
    const t = num(n);
    out += out && !t.startsWith('-') && !(t.startsWith('.') && /\.\d*$/.test(out)) ? ` ${t}` : t;
  }
  return out;
}
/**
 * Points as one path of round-capped marks `dash` long (0: a dot), each a
 * move relative to where the last mark ended: "M12 30h0m3.1-.4h0".
 */
function dots(pts: Array<{ x: number; y: number }>, dash = 0): string {
  let d = '';
  let px = 0;
  let py = 0;
  const h = `h${num(dash)}`;
  for (const p of pts) {
    const x = r1(p.x);
    const y = r1(p.y);
    d += d ? `m${nums(x - px, y - py)}${h}` : `M${nums(x, y)}${h}`;
    px = r1(x + dash);
    py = y;
  }
  return d;
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A cell's seeded jitter in [0, 1): the same valley always grows the same trees. */
function hash(i: number, j: number, k: number): number {
  let h = Math.imul(i + 0x9e37, 0x85ebca6b) ^ Math.imul(j + 0x7f4a, 0xc2b2ae35) ^ Math.imul(k + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** The valley at the model's resolution: per cell, seen, height (metres), and what grows there. */
export interface GlassGrid {
  w: number;
  h: number;
  /** Raw cells per model cell. */
  block: number;
  seen: Uint8Array;
  height: Float32Array;
  wood: Uint8Array;
  wet: Uint8Array;
}

/** The snapshot's grids, averaged in blocks when wider than MAX_GLASS_ACROSS. Null with nothing seen or a grid of the wrong size. */
export function glassGrid(terrain: WildmindTerrain): GlassGrid | null {
  const { w: W, h: H } = terrain;
  const t = Buffer.from(terrain.t, 'base64');
  const hb = Buffer.from(terrain.height, 'base64');
  if (t.length !== W * H || hb.length !== W * H) return null;
  const block = Math.max(1, Math.ceil(Math.max(W, H) / MAX_GLASS_ACROSS));
  const w = Math.ceil(W / block);
  const h = Math.ceil(H / block);
  const seen = new Uint8Array(w * h);
  const height = new Float32Array(w * h);
  const wood = new Uint8Array(w * h);
  const wet = new Uint8Array(w * h);
  let any = false;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let n = 0;
      let sum = 0;
      let water = 0;
      let trees = 0;
      let marsh = 0;
      for (let dz = 0; dz < block; dz++)
        for (let dx = 0; dx < block; dx++) {
          const x = i * block + dx;
          const z = j * block + dz;
          if (x >= W || z >= H) continue;
          const k = z * W + x;
          if (!t[k]) continue;
          const name = terrain.terrains[t[k] - 1] ?? '';
          n++;
          sum += hb[k] / 10 + FLOOR_M;
          if (WATER.has(name)) water++;
          if (WOOD.has(name)) trees++;
          if (WET.has(name)) marsh++;
        }
      if (!n) continue;
      const k = j * w + i;
      any = true;
      seen[k] = 1;
      // Water always lies under the sea-level card and land always on it, whatever the averaging says.
      const m = sum / n;
      height[k] = water * 2 > n ? Math.min(m, -0.1) : Math.max(m, 0.05);
      wood[k] = trees * 2 > n ? 1 : 0;
      wet[k] = marsh * 2 > n ? 1 : 0;
    }
  return any ? { w, h, block, seen, height, wood, wet } : null;
}

/** The cards' thresholds in metres, lowest first: the water card (everything seen), sea level, then a card a step. */
export function thresholds(grid: GlassGrid): number[] {
  let top = -Infinity;
  for (let k = 0; k < grid.seen.length; k++) if (grid.seen[k]) top = Math.max(top, grid.height[k]);
  const out = [FLOOR_M, 0];
  if (top < FIRST_STEP) return out;
  const room = MAX_CARDS - out.length;
  let step = 1;
  if (Math.floor(top - FIRST_STEP) + 1 > room) step = Math.ceil(((top - FIRST_STEP) / (room - 1)) * 2) / 2;
  for (let t = FIRST_STEP; t <= top + 1e-6 && out.length < MAX_CARDS; t += step) out.push(Math.round(t * 10) / 10);
  return out;
}

type Pt = [number, number];

/**
 * Closed rings where `field` ≥ 0, by marching squares over cell centres
 * (cell i's centre at i + 0.5). The grid is read with a ring of `outside`
 * round it, so every ring closes. Saddles are split by the cell's mean.
 * Rings keep the inside on their right.
 */
export function march(w: number, h: number, field: (i: number, j: number) => number, outside = UNSEEN): Pt[][] {
  const GW = w + 2;
  const GH = h + 2;
  const v = new Float32Array(GW * GH).fill(outside);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) v[(j + 1) * GW + i + 1] = field(i, j);
  const at = (i: number, j: number) => v[j * GW + i];
  // Every crossing lies on one grid edge: horizontal (i,j)→(i+1,j) or vertical (i,j)→(i,j+1).
  const H_ = (i: number, j: number) => (j * GW + i) * 2;
  const V_ = (i: number, j: number) => (j * GW + i) * 2 + 1;
  const next = new Int32Array(GW * GH * 2).fill(-1);
  const pos = new Float32Array(GW * GH * 4);
  const cross = (e: number, i: number, j: number, horizontal: boolean) => {
    const a = at(i, j);
    const b = horizontal ? at(i + 1, j) : at(i, j + 1);
    const f = b !== a ? (0 - a) / (b - a) : 0.5;
    // Grid point (i, j) is cell (i − 1, j − 1)'s centre: (i − 0.5, j − 0.5) in cell units.
    pos[e * 2] = horizontal ? i - 0.5 + f : i - 0.5;
    pos[e * 2 + 1] = horizontal ? j - 0.5 : j - 0.5 + f;
  };
  // Corners: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left; edges: 0 top, 1 right, 2 bottom, 3 left.
  const CORNER_OF: Record<string, number> = { '0,3': 0, '0,1': 1, '1,2': 2, '2,3': 3 };
  const CORNER_XY: Pt[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (let j = 0; j < GH - 1; j++)
    for (let i = 0; i < GW - 1; i++) {
      const c = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      const ins = c.map((x) => x >= 0);
      const idx = (ins[0] ? 8 : 0) | (ins[1] ? 4 : 0) | (ins[2] ? 2 : 0) | (ins[3] ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const centre = (c[0] + c[1] + c[2] + c[3]) / 4 >= 0;
      let pairs: Array<[number, number]>;
      switch (idx) {
        case 1:
        case 14:
          pairs = [[3, 2]];
          break;
        case 2:
        case 13:
          pairs = [[2, 1]];
          break;
        case 3:
        case 12:
          pairs = [[3, 1]];
          break;
        case 4:
        case 11:
          pairs = [[0, 1]];
          break;
        case 6:
        case 9:
          pairs = [[0, 2]];
          break;
        case 7:
        case 8:
          pairs = [[0, 3]];
          break;
        case 5:
          // b and d inside: joined through the middle when it is inside, else cut off apart.
          pairs = centre ? [[0, 3], [1, 2]] : [[0, 1], [3, 2]];
          break;
        default:
          // 10: a and c inside.
          pairs = centre ? [[0, 1], [3, 2]] : [[0, 3], [1, 2]];
      }
      const edgeId = (e: number) => (e === 0 ? H_(i, j) : e === 1 ? V_(i + 1, j) : e === 2 ? H_(i, j + 1) : V_(i, j));
      for (const [e1, e2] of pairs) {
        const ids = [edgeId(e1), edgeId(e2)];
        cross(ids[0], ...(e1 === 0 ? [i, j, true] : e1 === 1 ? [i + 1, j, false] : e1 === 2 ? [i, j + 1, true] : [i, j, false]) as [number, number, boolean]);
        cross(ids[1], ...(e2 === 0 ? [i, j, true] : e2 === 1 ? [i + 1, j, false] : e2 === 2 ? [i, j + 1, true] : [i, j, false]) as [number, number, boolean]);
        // The corner this segment cuts off (the corner both edges share), or any corner for a straight cut.
        const key = [Math.min(e1, e2), Math.max(e1, e2)].join(',');
        const corner = CORNER_OF[key] ?? 0;
        const inside = ins[corner];
        const [px, py] = [pos[ids[0] * 2], pos[ids[0] * 2 + 1]];
        const [qx, qy] = [pos[ids[1] * 2], pos[ids[1] * 2 + 1]];
        const cx = i - 0.5 + CORNER_XY[corner][0];
        const cy = j - 0.5 + CORNER_XY[corner][1];
        // Right of P→Q (y down) is (−dy, dx).
        const right = -(qy - py) * (cx - px) + (qx - px) * (cy - py) > 0;
        if (right === inside) next[ids[0]] = ids[1];
        else next[ids[1]] = ids[0];
      }
    }
  const rings: Pt[][] = [];
  const done = new Uint8Array(next.length);
  for (let e = 0; e < next.length; e++) {
    if (next[e] < 0 || done[e]) continue;
    const ring: Pt[] = [];
    let cur = e;
    while (cur >= 0 && !done[cur]) {
      done[cur] = 1;
      ring.push([pos[cur * 2], pos[cur * 2 + 1]]);
      cur = next[cur];
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/**
 * Which cells' centres lie inside a set of rings (even-odd), by scanline:
 * a cell (i, j) has its centre at (i + 0.5, j + 0.5) in the rings' units.
 */
export function fill(w: number, h: number, rings: Pt[][]): Uint8Array {
  const out = new Uint8Array(w * h);
  const xs: number[] = [];
  for (let j = 0; j < h; j++) {
    const y = j + 0.5;
    xs.length = 0;
    for (const r of rings)
      for (let k = 0; k < r.length; k++) {
        const [ax, ay] = r[k];
        const [bx, by] = r[(k + 1) % r.length];
        if (ay <= y === by <= y) continue;
        xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil(xs[q] - 0.5));
      const i1 = Math.min(w - 1, Math.ceil(xs[q + 1] - 0.5) - 1);
      for (let i = i0; i <= i1; i++) out[j * w + i] = 1;
    }
  }
  return out;
}

/** A ring's signed area (cell units squared). */
export function ringArea(r: Pt[]): number {
  let a = 0;
  for (let k = 0; k < r.length; k++) {
    const [x0, y0] = r[k];
    const [x1, y1] = r[(k + 1) % r.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let far = -1;
  let best = 0;
  for (let k = 1; k < pts.length - 1; k++) {
    const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / len;
    if (d > best) {
      best = d;
      far = k;
    }
  }
  if (best <= eps) return [pts[0], pts[pts.length - 1]];
  const left = rdp(pts.slice(0, far + 1), eps);
  return [...left.slice(0, -1), ...rdp(pts.slice(far), eps)];
}

/** A closed ring simplified: split at the point farthest from its first, each half simplified. */
export function simplifyRing(r: Pt[], eps: number): Pt[] {
  if (r.length <= 4) return r;
  let far = 0;
  let best = -1;
  for (let k = 1; k < r.length; k++) {
    const d = Math.hypot(r[k][0] - r[0][0], r[k][1] - r[0][1]);
    if (d > best) {
      best = d;
      far = k;
    }
  }
  const a = rdp(r.slice(0, far + 1), eps);
  const b = rdp([...r.slice(far), r[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/**
 * Rings as one smooth path: quadratic curves through each edge's midpoint,
 * the corners as control points. Relative after the first point of each ring,
 * from rounded positions, so the rounding never drifts.
 */
export function smoothPath(rings: Pt[][], to: (p: Pt) => Pt): string {
  let d = '';
  for (const ring of rings) {
    const pts = ring.map(to).map(([x, y]): Pt => [r1(x), r1(y)]);
    const n = pts.length;
    if (n < 3) continue;
    const mid = (a: Pt, b: Pt): Pt => [r1((a[0] + b[0]) / 2), r1((a[1] + b[1]) / 2)];
    let at = mid(pts[n - 1], pts[0]);
    d += `M${nums(at[0], at[1])}q`;
    for (let k = 0; k < n; k++) {
      const c = pts[k];
      const e = mid(c, pts[(k + 1) % n]);
      d += `${k ? (String(r1(c[0] - at[0])).startsWith('-') ? '' : ' ') : ''}${nums(c[0] - at[0], c[1] - at[1], e[0] - at[0], e[1] - at[1])}`;
      at = e;
    }
    d += 'z';
  }
  return d;
}

export interface BuiltGlass {
  glass: WildmindGlass;
  /** Outline points in all, trees in all (for the caps and the tests). */
  points: number;
  trees: number;
}

/**
 * A snapshot's terrain to the model, or null with nothing seen. `perMapUnit`
 * is how many of the snapshot's cells one unit of the answer's map spans (the
 * tracer's frame: wildmind-trace.server.ts), so people and huts, given in map
 * units, land on the right cells.
 */
export function buildGlass(terrain: WildmindTerrain, version: string, perMapUnit = 1): BuiltGlass | null {
  const grid = glassGrid(terrain);
  if (!grid) return null;
  const { w, h, seen, height } = grid;

  // The seen ground's extent, and the scale that fits it on the board.
  let i0 = w;
  let i1 = -1;
  let j0 = h;
  let j1 = -1;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      if (seen[j * w + i]) {
        i0 = Math.min(i0, i);
        i1 = Math.max(i1, i);
        j0 = Math.min(j0, j);
        j1 = Math.max(j1, j);
      }
  const sw = i1 - i0 + 1;
  const sh = j1 - j0 + 1;
  const s = Math.min((BOARD.w - 2 * BOARD.pad) / sw, (BOARD.d - 2 * BOARD.pad) / (sh * TILT), MAX_CELL * grid.block);
  const cx = (i0 + i1 + 1) / 2;
  const cy = (j0 + j1 + 1) / 2;
  const toBoard = ([x, y]: Pt): Pt => [BOARD.w / 2 + (x - cx) * s, BOARD.d / 2 + (y - cy) * s * TILT];

  // How high each card stands: the street's metres, a little stretched for a big valley seen small.
  const ts = thresholds(grid);
  const unitsPerMetre = s / (2 * terrain.step * grid.block);
  let dz = clamp(unitsPerMetre * 1.15, 3.2, 3.6);
  const span = ts[ts.length - 1] - FLOOR_M;
  if (BASE_LIFT + span * dz > MAX_LIFT) dz = (MAX_LIFT - BASE_LIFT) / span;
  const lifts = ts.map((t) => r1(BASE_LIFT + (t - FLOOR_M) * dz));

  // The outlines, simplified harder until they fit.
  const fields = ts.map((t, c) => (i: number, j: number) => {
    const k = j * w + i;
    if (!seen[k]) return UNSEEN;
    return c === 0 ? 1 : Math.min(height[k] - t, 1);
  });
  const raw = fields.map((f) => march(w, h, f));
  let rings: Pt[][][] = [];
  let points = 0;
  for (const [eps, minArea] of PASSES) {
    rings = raw.map((card) => card.filter((r) => Math.abs(ringArea(r)) >= minArea).map((r) => simplifyRing(r, eps)).filter((r) => r.length >= 3));
    points = rings.reduce((n, card) => n + card.reduce((m, r) => m + r.length, 0), 0);
    if (points <= MAX_POINTS) break;
  }

  // The card each cell stands on: the highest its height reaches whose kept
  // outline holds it, so nothing stands on a speck that was dropped.
  const band = new Uint8Array(w * h);
  const holds = rings.map((card, c) => (c ? fill(w, h, card) : null));
  for (let k = 0; k < w * h; k++) {
    if (!seen[k]) continue;
    let b = 0;
    for (let c = 1; c < ts.length; c++) if (height[k] >= ts[c]) b = c;
    while (b > 0 && !holds[b]![k]) b--;
    band[k] = b;
  }

  // Trees: lichen balls on wooded cells, as many as fit the cap, on the card they stand on.
  const r0 = clamp(0.36 * s, 1.5, 2.3);
  const radii: [number, number] = [r1(r0 * 0.85), r1(r0 * 1.15)];
  const spacing = 1.7 * r0;
  let woodCells = 0;
  for (let k = 0; k < w * h; k++) if (seen[k] && grid.wood[k]) woodCells++;
  const perCell = Math.min((s / spacing) ** 2, 1.6, woodCells ? MAX_TREES / woodCells : 0);
  const trees: Array<{ c: number; big: number; x: number; y: number }> = [];
  const marks: Array<{ c: number; x: number; y: number }> = [];
  const markEvery = Math.max(1, Math.round(4 / s));
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (!seen[k]) continue;
      const c = band[k];
      // No trees in the water: a wood on a speck too small to keep stands on the water card.
      if (grid.wood[k] && c) {
        const n = Math.floor(perCell) + (hash(i, j, 0) < perCell % 1 ? 1 : 0);
        for (let q = 0; q < n && trees.length < MAX_TREES; q++) {
          const big = hash(i, j, q * 3 + 1) < 0.45 ? 1 : 0;
          const [x, y] = toBoard([i + 0.15 + 0.7 * hash(i, j, q * 3 + 2), j + 0.15 + 0.7 * hash(i, j, q * 3 + 3)]);
          trees.push({ c, big, x, y: y - lifts[c] - radii[big] * 0.9 });
        }
      } else if (grid.wet[k] && i % markEvery === 0 && j % markEvery === 0) {
        const [x, y] = toBoard([i + 0.5, j + 0.5]);
        marks.push({ c, x, y: y - lifts[c] });
      }
    }
  trees.sort((a, b) => a.y - b.y);

  // A top card with nothing left to draw is not sent (nothing stands on it now).
  let n = ts.length;
  while (n > 1 && !rings[n - 1].length) n--;
  const cards: GlassCard[] = ts.slice(0, n).map((_, c) => {
    const card: GlassCard = { lift: lifts[c], d: smoothPath(rings[c], toBoard) };
    const mine = trees.filter((t) => t.c === c);
    if (mine.length) card.wood = [0, 1].map((big) => dots(mine.filter((t) => t.big === big))) as [string, string];
    const wet = marks.filter((m) => m.c === c);
    // A marsh mark is a short dash; the page draws it as one, and a second above it (one path, translated).
    if (wet.length) card.wet = dots(wet.map((m) => ({ x: m.x - 1.2, y: m.y })), 2.4);
    return card;
  });

  // Map units to model cells: a map unit is `perMapUnit` snapshot cells, a model cell `block` of them.
  const per = perMapUnit / grid.block;
  const [ox, oy] = toBoard([0, 0]);
  return {
    glass: {
      version,
      ox: r1(ox),
      oy: r1(oy),
      su: Math.round(s * per * 1000) / 1000,
      sv: Math.round(s * TILT * per * 1000) / 1000,
      cards,
      tree: radii,
      bands: encodeBands(band),
      gw: w,
      gh: h,
      per: Math.round(per * 1000) / 1000,
    },
    points,
    trees: trees.length,
  };
}

const cache = new Map<string, BuiltGlass | null>();

/** buildGlass, remembered for the last two terrain versions. */
export function glassCached(terrain: WildmindTerrain, version: string, perMapUnit = 1): BuiltGlass | null {
  const key = `${version}|${perMapUnit}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const built = buildGlass(terrain, version, perMapUnit);
  cache.set(key, built);
  while (cache.size > 2) cache.delete(cache.keys().next().value as string);
  return built;
}
