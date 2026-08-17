// The fitting catalogue and the plan geometry it implies.
//
// Everything is millimetres. A fitting is defined in its own coordinates —
// `w` runs along the wall it backs onto, `d` projects into the room — and a
// rotation of 0/90/180/270 maps it onto the four walls. `c` is the activity
// space in front of it (the room you actually need to stand in), `side` the
// extra elbow room a WC wants either side of the pan.

export type Kind = 'bath' | 'shower' | 'wc' | 'basin' | 'combo' | 'rail' | 'store';

export interface Fixture {
  n: string; // full name, used in prose and the brief
  s: string; // short label drawn on the plan
  w: number;
  d: number;
  c: number;
  side?: number;
  k: Kind;
}

export const FIX: Record<string, Fixture> = {
  bath17: { n: 'Bath 1700', s: 'BATH', w: 1700, d: 700, c: 700, k: 'bath' },
  bath16: { n: 'Bath 1600', s: 'BATH', w: 1600, d: 700, c: 700, k: 'bath' },
  bath15: { n: 'Bath 1500', s: 'BATH', w: 1500, d: 700, c: 700, k: 'bath' },
  pbath: { n: 'Shower bath', s: 'BATH', w: 1700, d: 850, c: 700, k: 'bath' },
  tray90: { n: 'Shower 900', s: 'SHR', w: 900, d: 900, c: 700, k: 'shower' },
  tray128: { n: 'Shower 1200', s: 'SHR', w: 1200, d: 800, c: 700, k: 'shower' },
  tray149: { n: 'Walk-in 1400', s: 'SHR', w: 1400, d: 900, c: 700, k: 'shower' },
  tray169: { n: 'Walk-in 1600', s: 'SHR', w: 1600, d: 900, c: 700, k: 'shower' },
  wcCC: { n: 'WC close-coupled', s: 'WC', w: 370, d: 700, c: 700, side: 200, k: 'wc' },
  wcWH: { n: 'WC wall-hung', s: 'WC', w: 370, d: 560, c: 700, side: 200, k: 'wc' },
  basin: { n: 'Basin + pedestal', s: 'BASIN', w: 550, d: 450, c: 700, k: 'basin' },
  basinSm: { n: 'Small basin', s: 'BASIN', w: 400, d: 300, c: 600, k: 'basin' },
  van60: { n: 'Vanity 600', s: 'VANITY', w: 600, d: 450, c: 700, k: 'basin' },
  van80: { n: 'Vanity 800', s: 'VANITY', w: 800, d: 450, c: 700, k: 'basin' },
  van100: { n: 'Vanity 1000', s: 'VANITY', w: 1000, d: 450, c: 700, k: 'basin' },
  combo: { n: 'WC + basin run', s: 'RUN', w: 1200, d: 500, c: 700, k: 'combo' },
  rail: { n: 'Towel rail', s: 'RAIL', w: 500, d: 120, c: 250, k: 'rail' },
  tall: { n: 'Tall cupboard', s: 'STORE', w: 400, d: 350, c: 600, k: 'store' },
  airing: { n: 'Airing cupboard', s: 'CUPB', w: 700, d: 600, c: 0, k: 'store' },
};

export const PALETTE_GROUPS: [string, string[]][] = [
  ['Baths', ['bath17', 'bath16', 'bath15', 'pbath']],
  ['Showers', ['tray90', 'tray128', 'tray149', 'tray169']],
  ['Toilets', ['wcCC', 'wcWH']],
  ['Basins and vanities', ['basin', 'basinSm', 'van60', 'van80', 'van100', 'combo']],
  ['Heat and storage', ['rail', 'tall', 'airing']],
];

export type Wall = 'N' | 'S' | 'W' | 'E';

export interface Item {
  id: number;
  t: string;
  x: number;
  y: number;
  r: 0 | 90 | 180 | 270;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Plan {
  W: number;
  D: number;
  door: { wall: Wall; pos: number; w: number; swing: 'in-l' | 'in-r' | 'out' | 'slide' };
  win: { on: boolean; wall: Wall; pos: number; w: number };
  stack: { wall: Wall; pos: number };
  notch: { on: boolean; corner: 'NE' | 'NW' | 'SE' | 'SW'; w: number; d: number };
  items: Item[];
  snap: boolean;
  zones: boolean;
  seq: number;
}

export const defaultPlan = (): Plan => ({
  W: 2100,
  D: 2400,
  door: { wall: 'S', pos: 150, w: 762, swing: 'in-l' },
  win: { on: true, wall: 'N', pos: 600, w: 900 },
  stack: { wall: 'N', pos: 1900 },
  notch: { on: false, corner: 'NE', w: 800, d: 350 },
  items: [],
  snap: true,
  zones: true,
  seq: 1,
});

/** The footprint a fitting occupies once rotated. */
export function foot(it: Item): Rect {
  const f = FIX[it.t];
  const turned = it.r % 180 !== 0;
  return { x: it.x, y: it.y, w: turned ? f.d : f.w, h: turned ? f.w : f.d };
}

/** The activity space in front of a fitting, or null if it needs none. */
export function zone(it: Item): Rect | null {
  const f = FIX[it.t];
  if (!f.c) return null;
  const b = foot(it);
  const s = f.side ?? 0;
  if (it.r === 0) return { x: b.x - s, y: b.y + b.h, w: b.w + 2 * s, h: f.c };
  if (it.r === 180) return { x: b.x - s, y: b.y - f.c, w: b.w + 2 * s, h: f.c };
  if (it.r === 90) return { x: b.x + b.w, y: b.y - s, w: f.c, h: b.h + 2 * s };
  return { x: b.x - f.c, y: b.y - s, w: f.c, h: b.h + 2 * s };
}

/** Area of the intersection of two rectangles, in mm². */
export function overlap(a: Rect | null, b: Rect | null): number {
  if (!a || !b) return 0;
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
}

export function notchRect(p: Plan): Rect | null {
  if (!p.notch.on) return null;
  const { corner, w, d } = p.notch;
  return { x: corner[1] === 'W' ? 0 : p.W - w, y: corner[0] === 'N' ? 0 : p.D - d, w, h: d };
}

export function wallPt(p: Plan, wall: Wall, pos: number): { x: number; y: number } {
  if (wall === 'N') return { x: pos, y: 0 };
  if (wall === 'S') return { x: pos, y: p.D };
  if (wall === 'W') return { x: 0, y: pos };
  return { x: p.W, y: pos };
}

export const wallLength = (p: Plan, wall: Wall) => (wall === 'N' || wall === 'S' ? p.W : p.D);

export const WALL_NAME: Record<Wall, string> = {
  N: 'top',
  S: 'bottom',
  W: 'left',
  E: 'right',
};

/** SVG transform placing a fitting's local (0,0)–(w,d) box at its rotation. */
export function itemTransform(it: Item): string {
  const f = FIX[it.t];
  if (it.r === 0) return `translate(${it.x},${it.y})`;
  if (it.r === 90) return `translate(${it.x},${it.y}) rotate(90) translate(0,${-f.d})`;
  if (it.r === 180) return `translate(${it.x},${it.y}) rotate(180) translate(${-f.w},${-f.d})`;
  return `translate(${it.x},${it.y}) rotate(270) translate(${-f.w},0)`;
}

/** Door leaf, hinge and swing footprint, all in room coordinates. */
export function doorGeom(p: Plan) {
  const { wall, pos, w: dw, swing } = p.door;
  const { W, D } = p;
  let A: { x: number; y: number }, B: { x: number; y: number };
  let O1: { x: number; y: number }, O2: { x: number; y: number };
  if (wall === 'N') {
    A = { x: pos, y: 0 };
    B = { x: pos + dw, y: 0 };
    O1 = { x: pos, y: dw };
    O2 = { x: pos + dw, y: dw };
  } else if (wall === 'S') {
    A = { x: pos, y: D };
    B = { x: pos + dw, y: D };
    O1 = { x: pos, y: D - dw };
    O2 = { x: pos + dw, y: D - dw };
  } else if (wall === 'W') {
    A = { x: 0, y: pos };
    B = { x: 0, y: pos + dw };
    O1 = { x: dw, y: pos };
    O2 = { x: dw, y: pos + dw };
  } else {
    A = { x: W, y: pos };
    B = { x: W, y: pos + dw };
    O1 = { x: W - dw, y: pos };
    O2 = { x: W - dw, y: pos + dw };
  }
  const right = swing === 'in-r';
  const H = right ? B : A;
  const C = right ? A : B;
  const O = right ? O2 : O1;

  let sq: Rect | null = null;
  if (swing.startsWith('in')) {
    if (wall === 'N') sq = { x: pos, y: 0, w: dw, h: dw };
    else if (wall === 'S') sq = { x: pos, y: D - dw, w: dw, h: dw };
    else if (wall === 'W') sq = { x: 0, y: pos, w: dw, h: dw };
    else sq = { x: W - dw, y: pos, w: dw, h: dw };
  }
  // Sweep direction for the SVG arc: positive cross product means the arc
  // bulges clockwise on screen (y grows downward).
  const cross = (C.x - H.x) * (O.y - H.y) - (C.y - H.y) * (O.x - H.x);
  return { A, B, H, C, O, sq, dw, sweep: cross > 0 ? 1 : 0 };
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Move a fitting to (nx, ny), snapping to a 25 mm grid, flush to any wall or
 * chimney-breast edge within 150 mm, and clamped inside the room.
 */
export function place(p: Plan, it: Item, nx: number, ny: number) {
  const b = foot(it);
  const T = 150;
  const G = 25;
  let x = Math.round(nx / G) * G;
  let y = Math.round(ny / G) * G;
  if (p.snap) {
    if (Math.abs(x) < T) x = 0;
    if (Math.abs(x + b.w - p.W) < T) x = p.W - b.w;
    if (Math.abs(y) < T) y = 0;
    if (Math.abs(y + b.h - p.D) < T) y = p.D - b.h;
    const nr = notchRect(p);
    if (nr) {
      if (Math.abs(x - (nr.x + nr.w)) < T) x = nr.x + nr.w;
      if (Math.abs(x + b.w - nr.x) < T) x = nr.x - b.w;
      if (Math.abs(y - (nr.y + nr.h)) < T) y = nr.y + nr.h;
      if (Math.abs(y + b.h - nr.y) < T) y = nr.y - b.h;
    }
  }
  it.x = Math.round(clamp(x, Math.min(0, p.W - b.w), Math.max(0, p.W - b.w)));
  it.y = Math.round(clamp(y, Math.min(0, p.D - b.h), Math.max(0, p.D - b.h)));
}
