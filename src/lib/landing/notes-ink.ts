// notes-ink.ts — the pen behind the hero's "notes" view: every mark on the
// annotated sheet (the heartbeat underline, the ring round the pulse, the
// ruler of the day, the tallies, the daydream dial) as a plain SVG path.
//
// The ink is cheap on purpose. Each stroke is drawn once, with a seeded
// wobble baked into its points, so it looks done by hand without a
// displacement filter or a redraw: the browser paints static paths. The one
// thing that "boils" is the ring round the pulse, and that is three takes of
// the same ring (inkRing with three seeds) swapped by CSS.
//
// Pure and seeded, like traces.ts: the same inputs give the same path on the
// server and in the browser, so hydration never redraws, and the honesty
// rules (no beats without a reading, nothing drawn after now, a tally per
// deploy) are unit tests in notes-ink.test.ts.

import { BPM_MAX, BPM_MIN, HEART_PX_PER_SECOND, clampBpm } from './traces';

export type Pt = [number, number];

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A small seeded generator (mulberry32), so a wobble is the same every time. */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ± `amp`, from the pen's own generator. */
const jit = (r: () => number, amp: number) => (r() * 2 - 1) * amp;

/** Points joined by straight strokes: an ECG's spikes stay sharp. */
export const poly = (p: Pt[]) => 'M' + p.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' L');

/** A smooth curve through the points (Catmull-Rom as cubic Béziers). */
export function smooth(p: Pt[]): string {
  if (p.length < 3) return poly(p);
  let d = `M${r1(p[0][0])},${r1(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] ?? p[i];
    const b = p[i];
    const c = p[i + 1];
    const e = p[i + 2] ?? c;
    d +=
      ` C${r1(b[0] + (c[0] - a[0]) / 6)},${r1(b[1] + (c[1] - a[1]) / 6)}` +
      ` ${r1(c[0] - (e[0] - b[0]) / 6)},${r1(c[1] - (e[1] - b[1]) / 6)} ${r1(c[0])},${r1(c[1])}`;
  }
  return d;
}

/** A straight stroke drawn by hand: both ends nudged, a slight bow in the middle. */
export function inkLine(r: () => number, x1: number, y1: number, x2: number, y2: number, amp = 0.6, bow = 0.015): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const b = jit(r, len * bow);
  return smooth([
    [x1 + jit(r, amp), y1 + jit(r, amp)],
    [x1 + dx / 2 - (dy / len) * b, y1 + dy / 2 + (dx / len) * b],
    [x2 + jit(r, amp), y2 + jit(r, amp)],
  ]);
}

/**
 * A loop drawn round something: a little more than one turn, so the pen
 * overshoots where it comes back, as a circled word is circled.
 */
export function inkRing(r: () => number, cx: number, cy: number, rx: number, ry: number, turns = 1.1, wob = 0.045): string {
  const a0 = -2.2 + jit(r, 0.35);
  const n = 16;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + t * Math.PI * 2 * turns;
    // The second pass drifts outwards a touch, as a hand does.
    const k = 1 + jit(r, wob) + (t > 0.9 ? 0.04 : 0);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return smooth(pts);
}

/* ------------------------------------------------------- the heartbeat line */

export interface InkHeart {
  /** The path, in pixels: `width` across, `height` down. */
  d: string;
  /** Whole beats drawn; 0 for the flat line. */
  beats: number;
  /** How far through a beat, along the line, its R wave peaks (see traces.ts heartLine). */
  peak: number;
}

/**
 * The hand-drawn heartbeat under the title: one PQRST complex per beat at the
 * exact rate read, or a slightly wobbly flat line when there is no fresh
 * reading. The same paper speed and whole-beat strip as heartLine in
 * traces.ts, so a sweep that crosses the path in `beats` heartbeats crosses
 * one complex per real beat; the wobble only moves points by a pixel or so,
 * which no eye reads as a change of rate.
 */
export function inkHeart(bpm: number | null, width: number, height: number, seed = 7): InkHeart {
  const w = Math.max(24, Math.round(width));
  const h = Math.max(24, Math.round(height));
  const r = rng(seed);
  const base = h * 0.64;

  // A long flat stretch gets a point every ~18px, so the hand shows on it too.
  const flat = (pts: Pt[], x0: number, x1: number) => {
    const n = Math.floor((x1 - x0) / 18);
    for (let k = 1; k <= n; k++) pts.push([x0 + ((x1 - x0) * k) / (n + 1), base + jit(r, 0.7)]);
  };

  if (bpm == null || !(bpm > 0)) {
    const pts: Pt[] = [[0, base]];
    flat(pts, 0, w);
    pts.push([w, base]);
    return { d: smooth(pts), beats: 0, peak: 0 };
  }

  const beatSec = 60 / clampBpm(bpm);
  const seconds = clamp(w / HEART_PX_PER_SECOND, 3, 14);
  const beats = Math.max(1, Math.round(seconds / beatSec));
  const span = w / beats;
  const pxs = (span / beatSec) * Math.min(1, beatSec / 0.85);

  const pts: Pt[] = [[0, base]];
  let toPeak = 0;
  let beatLen = 0;
  for (let i = 0; i < beats; i++) {
    const x = (t: number) => i * span + t * pxs + jit(r, 0.35);
    const amp = 1 + jit(r, 0.06);
    const start = pts.length - 1;
    flat(pts, i * span, i * span + 0.12 * pxs);
    // P: a small hump, drawn as four points rather than a curve.
    pts.push([x(0.12), base], [x(0.15), base - h * 0.07], [x(0.19), base - h * 0.1 * amp], [x(0.22), base + jit(r, 0.5)]);
    pts.push([x(0.3), base], [x(0.33), base + h * 0.07]);
    // R and S, sharp; R's height wanders a few per cent beat to beat.
    const rx = x(0.37);
    pts.push([rx, h * 0.05 + jit(r, h * 0.03)], [x(0.41), Math.min(h - 1.5, h * 0.92 + jit(r, 1))], [x(0.44), base]);
    const rAt = pts.length - 3;
    // T: a wider hump.
    pts.push([x(0.54), base], [x(0.6), base - h * 0.13 * amp], [x(0.66), base - h * 0.19 * amp], [x(0.72), base - h * 0.1]);
    pts.push([x(0.76), base + jit(r, 0.5)]);
    flat(pts, x(0.76), (i + 1) * span);
    if (i === 0) {
      // Along-the-line share of the first beat at which the R wave peaks.
      const len = (from: number, to: number) => {
        let s = 0;
        for (let k = from + 1; k <= to; k++) s += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        return s;
      };
      toPeak = len(start, rAt);
      beatLen = len(start, pts.length - 1) + Math.hypot(span - pts[pts.length - 1][0], base - pts[pts.length - 1][1]);
    }
  }
  pts.push([w, base]);
  return { d: poly(pts), beats, peak: Math.round((toPeak / beatLen) * 1000) / 1000 };
}

/** The curl from the end of the heartbeat line up into the ring round the reading. */
export function inkHook(w: number, h: number, seed = 11): string {
  const r = rng(seed);
  const base = h * 0.64;
  return smooth([
    [0, base],
    [w * 0.45, base + jit(r, 0.6)],
    [w * 0.82, base - h * 0.08],
    [w, base - h * 0.2],
  ]);
}

/* ------------------------------------------------------ the ruler of the day */

export interface Ruler {
  /** The outline: four strokes, the top one near flat (the rambler sits on it). */
  frame: string;
  /** An hour tick hanging from the top edge, a longer one every six. */
  ticks: string;
  /** A pencil stroke per quarter-hour with steps, stood on the bottom edge. */
  quiet: string;
  /** The same, for the busy quarter-hours (half the busiest or more), inked in orange. */
  busy: string;
  /** Diagonal hatching over the part of the day still to come. */
  hatch: string;
  /** Where now falls: the far edge of the quarter-hour in progress, in px. */
  now: number;
  /** The inside edges of the ruler, in px: midnight and 23:59. */
  x0: number;
  x1: number;
}

/**
 * Today on a hand-drawn ruler, `w` × `h` pixels: midnight at the left end,
 * 23:59 at the right, one stroke per quarter-hour that has steps, nothing
 * after now, and everything after now hatched. `bins` null (no steps have
 * arrived) leaves the ruler empty but still hatched from now on.
 */
export function inkRuler(w: number, h: number, bins: number[] | null, nowBin: number, seed = 3): Ruler {
  const r = rng(seed);
  const W = Math.max(48, w);
  const x0 = 6;
  const x1 = W - 6;
  const top = 1.5;
  const bot = h - 1.5;
  const step = (x1 - x0) / 96;
  const nb = clamp(Math.floor(nowBin), 0, 95);

  const frame =
    inkLine(r, 1, top, W - 1, top, 0.25, 0.001) +
    ' ' +
    inkLine(r, W - 1, top, W - 1, bot, 0.5, 0.01) +
    ' ' +
    inkLine(r, W - 1, bot, 1, bot, 0.5, 0.003) +
    ' ' +
    inkLine(r, 1, bot, 1, top, 0.5, 0.01);

  let ticks = '';
  for (let hr = 0; hr <= 24; hr++) {
    const x = x0 + hr * 4 * step;
    const len = hr % 6 === 0 ? 12 : 6;
    ticks += `M${r1(x + jit(r, 0.3))},${top} L${r1(x + jit(r, 0.4))},${r1(top + len + jit(r, 0.6))} `;
  }

  let quiet = '';
  let busy = '';
  if (bins) {
    const peak = Math.max(1, ...bins.slice(0, nb + 1));
    const tall = bot - (top + 16);
    bins.forEach((v, i) => {
      if (i > nb || !(v > 0)) return;
      const x = x0 + (i + 0.5) * step;
      const y = bot - 1 - tall * Math.max(0.08, v / peak);
      const s = `M${r1(x + jit(r, 0.3))},${r1(bot - 1)} L${r1(x + jit(r, 0.6))},${r1(y)} `;
      if (v / peak >= 0.5) busy += s;
      else quiet += s;
    });
  }

  // The hatch: 45° strokes every 7px from now to the end, clipped to the box.
  const now = x0 + (nb + 1) * step;
  const hTop = top + 14;
  const rise = bot - hTop;
  let hatch = '';
  for (let x = now - rise; x < x1; x += 7) {
    const sx = Math.max(x, now);
    const ex = Math.min(x + rise, x1);
    if (ex - sx < 2) continue;
    hatch += `M${r1(sx)},${r1(bot - (sx - x) + jit(r, 0.4))} L${r1(ex + jit(r, 0.4))},${r1(bot - (ex - x))} `;
  }

  return { frame, ticks: ticks.trim(), quiet: quiet.trim(), busy: busy.trim(), hatch: hatch.trim(), now: r1(now), x0, x1: r1(x1) };
}

/** The hour labels under the ruler that do not collide with the "now-ish" mark at `now`. */
export function rulerHours(x0: number, x1: number, now: number, room = 46): Array<{ h: number; x: number }> {
  return [0, 6, 12, 18, 24].map((h) => ({ h, x: r1(x0 + (h / 24) * (x1 - x0)) })).filter((l) => Math.abs(l.x - now) >= room);
}

/* --------------------------------------------------------------- the tallies */

/** Room for one five-bar gate: four strokes 3px apart, the slash's overhang, a gap. */
export const GATE_PITCH = 15;

export interface Tally {
  d: string;
  /** Strokes left uncounted when the cell is too narrow for all the gates; shown as "+n". */
  more: number;
  /** Where the "+n" goes, in px. */
  moreX: number;
}

/**
 * One day's deploys as tally marks in a cell `w` wide and `h` tall: gates of
 * five (four uprights and a slash) from the left, then the odd strokes. Every
 * deploy is one stroke; when they do not all fit, the last gate's room says
 * "+n" instead of squeezing the strokes past counting.
 */
export function inkTally(count: number, w: number, h: number, seed: number): Tally {
  const r = rng(seed);
  const n = Math.max(0, Math.floor(count));
  const groups = Math.ceil(n / 5);
  const fit = Math.max(1, Math.floor((w + 4) / GATE_PITCH));
  const shown = groups <= fit ? n : (fit - 1) * 5;
  let d = '';
  const y0 = h - 1;
  const y1 = 1.5;
  for (let g = 0; g * 5 < shown; g++) {
    const gx = g * GATE_PITCH + 2;
    const k = Math.min(5, shown - g * 5);
    for (let s = 0; s < Math.min(4, k); s++) {
      const x = gx + s * 3;
      d += `M${r1(x + jit(r, 0.3))},${r1(y0 + jit(r, 0.4))} L${r1(x + jit(r, 0.5))},${r1(y1 + jit(r, 0.5))} `;
    }
    if (k === 5) d += `M${r1(gx - 1.5)},${r1(y0 - 2 + jit(r, 0.5))} L${r1(gx + 10.5)},${r1(y1 + 2 + jit(r, 0.5))} `;
  }
  return { d: d.trim(), more: n - shown, moreX: (fit - 1) * GATE_PITCH };
}

/* ------------------------------------------------------------------ the dial */

/**
 * The daydream dial's shaded wedge: `f` of a turn clockwise from twelve, as a
 * Time Timer shows what is left (it shrinks back to twelve as the next think
 * nears). Null for nothing to shade.
 */
export function dialWedge(cx: number, cy: number, rad: number, f: number | null): string | null {
  if (f == null || !(f > 0)) return null;
  const t = Math.min(1, f);
  if (t >= 0.999) return `M${cx},${r1(cy - rad)} A${rad},${rad} 0 1 1 ${cx},${r1(cy + rad)} A${rad},${rad} 0 1 1 ${cx},${r1(cy - rad)} Z`;
  const a = t * Math.PI * 2;
  const x = r1(cx + Math.sin(a) * rad);
  const y = r1(cy - Math.cos(a) * rad);
  return `M${cx},${cy} L${cx},${r1(cy - rad)} A${rad},${rad} 0 ${t > 0.5 ? 1 : 0} 1 ${x},${y} Z`;
}

/** The dial's hand: from the centre to `f` of a turn clockwise from twelve. */
export function dialHand(cx: number, cy: number, len: number, f: number, seed = 5): string {
  const a = clamp(f, 0, 1) * Math.PI * 2;
  return inkLine(rng(seed), cx, cy, cx + Math.sin(a) * len, cy - Math.cos(a) * len, 0.3, 0.02);
}

/** The rates the line can draw, re-exported for the copy that says so. */
export { BPM_MIN, BPM_MAX };
