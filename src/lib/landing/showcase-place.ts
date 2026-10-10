// showcase-place.ts — the geometry and the words of the landing showcase told
// in the "place" view: the night walk down the page under the hero's
// landscape. Four hand-built scenes and a signpost.
//
//   the observatory   Daydream: a star for every question it asked itself
//                     this week, a constellation of twelve weeks of verdicts,
//                     crossed-out stars for the claims its auditor struck,
//                     shooting stars for the ideas that shipped, and a dome
//                     lit for the hours it spent thinking.
//   the long walk     Health: a path of every kilometre on foot this year
//                     with a post at each milestone, thirty trees for the
//                     last thirty days of steps, thirty lanterns for the
//                     recovery readings, a moon for the week's sleep.
//   the house         The app: a block of lit windows, a doorway each, and a
//                     cottage with a phone on the sill.
//   the works         Shipping: a crane over the edge of town lowering
//                     today's deploys, and the builder's lit sign.
//
// Every scene is drawn in a 1000-wide box of its own height (SceneBox), so
// the server and the browser draw the same picture and nothing is measured.
// Anything that looks random is seeded. Pure: inputs in, numbers, path
// strings and words out, every function unit-tested (showcase-place.test.ts).
//
// The copy follows the landing page's rules: figures only ever come from the
// data (no digits in the words below, a test reads this file to make sure),
// en-GB grouping, a real minus sign, null is a dash with a spoken
// alternative, and nothing says where anyone is or how long a reading has
// been missing.

import { COUNT_MS, formatFigure } from './showcase-motion';
import { shiftDay, TEN_THOUSAND } from './showcase-data';
import { clock, countWord } from './sentence';
import type { Daydream } from './sentence';
import type { StepsToday } from './steps';
import type { DaydreamShowcase, HealthShowcase, AppShowcase, BuildShowcase } from './showcase';
import type { LandingVitals } from './live-vitals.svelte';


const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The width every scene is drawn at; each has its own height. */
export const SCENE_W = 1000;

/* ----------------------------------------------------------------- random */

/** A small seeded generator (mulberry32): the same picture on every load. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inside = (x: number, y: number, b: Box, pad = 0) =>
  x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

/**
 * `n` points scattered over `area`, none inside an `avoid` box, kept `gap`
 * apart where the room allows. Deterministic for a seed. Always returns `n`
 * points: when the room runs out the spacing relaxes rather than the count.
 */
export function scatter(n: number, area: Box, avoid: Box[], seed: number, gap = 9): Array<[number, number]> {
  const count = Math.max(0, Math.floor(n));
  const rnd = seeded(seed);
  const out: Array<[number, number]> = [];
  let g = gap;
  let tries = 0;
  while (out.length < count) {
    const x = area.x + rnd() * area.w;
    const y = area.y + rnd() * area.h;
    tries++;
    // Relax the spacing every few hundred misses, so a crowded sky still fills.
    if (tries % 400 === 0) g *= 0.8;
    if (avoid.some((b) => inside(x, y, b))) {
      if (tries > 40_000) break;
      continue;
    }
    if (g > 0.5 && out.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < g * g)) continue;
    out.push([r1(x), r1(y)]);
  }
  return out;
}

/**
 * Roughly where a pinned label's text will stand, in scene units, so a
 * scatter can keep its stars out from behind the words. `lead` is in px and
 * `ppu` is px per scene unit (about 1.1 to 1.2 across the widths that pin).
 */
export function labelBox(
  p: { x: number; y: number; lead: number; dir?: 'up' | 'down' | 'side'; hang: 'l' | 'r' },
  w = 190,
  h = 70,
  ppu = 1.1,
): Box {
  const lead = p.lead / ppu;
  const dir = p.dir ?? 'up';
  if (dir === 'side') {
    const x = p.hang === 'r' ? p.x + lead : p.x - lead - w;
    return { x, y: p.y - h / 2, w, h };
  }
  const x = p.hang === 'r' ? p.x - 4 : p.x - w + 4;
  return dir === 'up' ? { x, y: p.y - lead - h, w, h } : { x, y: p.y + lead, w, h };
}

/**
 * When the `i`th of `n` things (0-based) should appear so that they keep pace
 * with a figure counting up over `duration` ms on the shared ease-out: the
 * moment the count reaches i + 1. The last lands as the count does.
 */
export function countDelay(i: number, n: number, duration = COUNT_MS): number {
  if (!(n > 0)) return 0;
  const p = clamp((i + 1) / n, 0, 1);
  // easeOut(t) = 1 − (1 − t)³, inverted.
  return Math.round((1 - Math.cbrt(1 - p)) * duration);
}

/* ------------------------------------------------------------ observatory */

/** Most stars the sky draws; past this it draws this many and says so. */
export const STAR_CAP = 360;
/** A question star this big or bigger has a soft glow. */
export const BIG_STAR = 2.4;
/** Most shooting stars; a big number reads as a meteor shower, not a fact. */
export const METEOR_CAP = 9;

export interface Star {
  x: number;
  y: number;
  /** Radius in scene units; the biggest (BIG_STAR) carry a glow. */
  r: number;
  /** Delay before it flickers on, ms, in step with the headline count. */
  d: number;
  /** One in a few twinkles, gently and briefly. */
  tw: boolean;
}

export interface Sky {
  stars: Star[];
  /** Questions drawn (≤ STAR_CAP) and asked; `capped` when not all fit. */
  drawn: number;
  asked: number | null;
  capped: boolean;
  /** The claims struck out, as faint crossed stars. */
  struck: Array<{ x: number; y: number }>;
}

/** One star per question asked this week, over `area`, clear of `avoid`. */
export function questionSky(
  questions: number | null,
  struckOut: number | null,
  area: Box,
  avoid: Box[],
  /** Where the first crossed star goes, so its label has somewhere to point. */
  struckAt?: [number, number],
): Sky {
  const asked = questions == null || !Number.isFinite(questions) ? null : Math.max(0, Math.round(questions));
  const drawn = Math.min(asked ?? 0, STAR_CAP);
  const struckN = Math.min(Math.max(0, Math.round(struckOut ?? 0)), STAR_CAP);
  const rnd = seeded(4242);
  const pts = scatter(drawn + struckN, area, avoid, 20261010, 11);
  const stars = pts.slice(0, drawn).map(([x, y], i) => {
    // A range of sizes so the field reads as a lot: about one in ten big
    // enough to carry a soft glow, the rest small and fainter.
    const big = rnd();
    return { x, y, r: big < 0.1 ? 2.4 : big < 0.35 ? 1.6 : big < 0.7 ? 1.2 : 0.9, d: countDelay(i, drawn), tw: i % 7 === 3 };
  });
  const struck = pts.slice(drawn).map(([x, y]) => ({ x, y }));
  if (struckAt && struck.length) struck[0] = { x: struckAt[0], y: struckAt[1] };
  return { stars, drawn, asked, capped: asked != null && asked > STAR_CAP, struck };
}

export interface Verdict {
  x: number;
  y: number;
  r: number;
  /** Share marked useful that week, or null when nothing was rated. */
  rate: number | null;
  rated: number;
  start: string;
}

/**
 * Twelve weeks of verdicts as a constellation over `box`: a star a week,
 * left (oldest) to right, higher where more of that week's rated notes were
 * marked useful, larger where more were rated. A week with nothing rated has
 * no star and breaks the line, so a gap never reads as a bad week.
 */
export function constellation(weeks: NonNullable<DaydreamShowcase['impact']>['weeks'] | null | undefined, box: Box): { points: Verdict[]; d: string } {
  if (!weeks?.length) return { points: [], d: '' };
  const n = weeks.length;
  const most = Math.max(1, ...weeks.map((w) => w.useful + w.notUseful));
  const points = weeks.map((w, i) => {
    const rated = w.useful + w.notUseful;
    const rate = rated > 0 ? w.useful / rated : null;
    return {
      x: r1(box.x + (n === 1 ? box.w / 2 : (i / (n - 1)) * box.w)),
      y: r1(box.y + box.h * (1 - (rate ?? 0))),
      r: r1(1.6 + 1 * Math.sqrt(rated / most)),
      rate,
      rated,
      start: w.start,
    };
  });
  let d = '';
  let pen = false;
  for (const p of points) {
    if (p.rate == null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${p.x},${p.y} `;
    pen = true;
  }
  return { points, d: d.trim() };
}

/** Which way the hit rate moved against the window before, or null with nothing to compare. */
export function trend(now: number | null | undefined, before: number | null | undefined): 'up' | 'down' | 'level' | null {
  if (now == null || before == null) return null;
  const a = Math.round(now * 100);
  const b = Math.round(before * 100);
  return a > b ? 'up' : a < b ? 'down' : 'level';
}

/** The dome's panels, one per area of life, lit for each it covered this week. */
export function domePanels(covered: number | null | undefined, areas: number): boolean[] {
  const n = Math.max(1, Math.round(areas));
  const lit = clamp(Math.round(covered ?? 0), 0, n);
  // Lit from the middle outwards, so a partial dome looks lived-in, not half-built.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2) || a - b);
  const on = new Set(order.slice(0, lit));
  return Array.from({ length: n }, (_, i) => on.has(i));
}

/**
 * How much of the dome's slit is lit: the hours spent thinking this week as a
 * share of the week's waking hours (the loop's active hours, seven days).
 */
export function slitShare(hours: number | null | undefined, active: { start: number; end: number }): number {
  const awake = Math.max(1, (active.end - active.start) * 7);
  if (hours == null || !(hours > 0)) return 0;
  return Math.round(clamp(hours / awake, 0, 1) * 1000) / 1000;
}

/** Shooting stars for the ideas that shipped, falling down and to the right across `area`. */
export function meteors(n: number | null | undefined, area: Box): Array<{ x1: number; y1: number; x2: number; y2: number; d: number }> {
  const count = clamp(Math.round(n ?? 0), 0, METEOR_CAP);
  const rnd = seeded(77);
  return Array.from({ length: count }, (_, i) => {
    const x1 = r1(area.x + ((i + 0.2 + rnd() * 0.6) / count) * area.w);
    const y1 = r1(area.y + rnd() * area.h * 0.5);
    const len = 46 + rnd() * 34;
    return { x1, y1, x2: r1(x1 + len * 0.86), y2: r1(y1 + len * 0.5), d: 380 + i * 260 };
  });
}

/* -------------------------------------------------------------- long walk */

/** A smooth path through points (Catmull–Rom as cubic Béziers). */
export function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [r1(p1[0] + (p2[0] - p0[0]) / 6), r1(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [r1(p2[0] - (p3[0] - p1[0]) / 6), r1(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** Points along the same smooth path, `per` samples a segment, for measuring it. */
export function samplePath(pts: Array<[number, number]>, per = 24): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    for (let k = i ? 1 : 0; k <= per; k++) {
      const t = k / per;
      const u = 1 - t;
      const x = u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0];
      const y = u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1];
      out.push([x, y]);
    }
  }
  return out;
}

/** The point `share` (0..1) of the way along a sampled path, by length. */
export function along(samples: Array<[number, number]>, share: number): [number, number] {
  if (!samples.length) return [0, 0];
  const seg: number[] = [0];
  for (let i = 1; i < samples.length; i++) seg.push(seg[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
  const total = seg[seg.length - 1];
  const want = clamp(share, 0, 1) * total;
  let i = 1;
  while (i < seg.length - 1 && seg[i] < want) i++;
  const span = seg[i] - seg[i - 1] || 1;
  const t = clamp((want - seg[i - 1]) / span, 0, 1);
  const a = samples[i - 1];
  const b = samples[Math.min(i, samples.length - 1)];
  return [r1(a[0] + (b[0] - a[0]) * t), r1(a[1] + (b[1] - a[1]) * t)];
}

/** A milestone interval that puts no more than `most` posts along `km`. */
export function milestoneStep(km: number, most = 18): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000];
  for (const s of steps) if (km / s <= most) return s;
  return Math.ceil(km / most / 10_000) * 10_000;
}

export interface Walk {
  d: string;
  /** Milestone posts along it, by distance. */
  posts: Array<{ x: number; y: number }>;
  step: number;
  /** The path's two ends. */
  start: [number, number];
  end: [number, number];
}

/** The switchbacks the walk comes down, January far off at the top left. */
export const WALK_POINTS: Array<[number, number]> = [
  [40, 128],
  [520, 138],
  [600, 156],
  [566, 180],
  [120, 194],
  [56, 214],
  [92, 238],
  [580, 250],
  [640, 264],
];

/**
 * The year on foot as a path: its length stands for `km`, with a post every
 * milestone step. The path is distance only: no day is marked on it, because
 * a date along a path of kilometres would sit in the wrong place.
 */
export function walk(km: number | null | undefined): Walk {
  const samples = samplePath(WALK_POINTS);
  const d = smoothPath(WALK_POINTS);
  const total = km != null && km > 0 ? km : 0;
  const step = total > 0 ? milestoneStep(total) : 0;
  const posts: Walk['posts'] = [];
  if (step > 0) for (let k = step; k < total; k += step) posts.push(((p) => ({ x: p[0], y: p[1] }))(along(samples, k / total)));
  return { d, posts, step, start: WALK_POINTS[0], end: WALK_POINTS[WALK_POINTS.length - 1] };
}

export interface Tree {
  /** Its place in the window, oldest first. */
  i: number;
  steps: number;
  x: number;
  /** Height in scene units, standing on `base`. */
  h: number;
  over: boolean;
  tallest: boolean;
}

/**
 * The window's days (oldest first, ending on the latest complete day with
 * readings) as a row of trees across `box` (standing on its bottom edge),
 * each as tall as its steps. A day with no reading is a gap rather than a
 * stump. The scale always reaches the ten-thousand line, which comes back as
 * `line` (y), or null with no days.
 */
export function stepTrees(
  steps30: HealthShowcase['steps30'],
  box: Box,
  days = 30,
): { trees: Tree[]; line: number | null; over: number; pitch: number } {
  const pitch = box.w / days;
  // The last `days` of the window, right-aligned so the latest stands at the right edge.
  const slice = (steps30 ?? []).slice(-days);
  const off = days - slice.length;
  const kept = slice
    .map((steps, i) => ({ i: i + off, steps }))
    .filter((s): s is { i: number; steps: number } => s.steps != null && Number.isFinite(s.steps) && s.steps >= 0);
  if (!kept.length) return { trees: [], line: null, over: 0, pitch };
  const peak = Math.max(TEN_THOUSAND * 1.15, ...kept.map((s) => s.steps));
  const top = Math.max(...kept.map((s) => s.steps), -1);
  const base = box.y + box.h;
  let marked = false;
  const trees = kept.map((s) => {
    const tallest = !marked && s.steps === top && top > 0;
    if (tallest) marked = true;
    return {
      i: s.i,
      steps: s.steps,
      x: r1(box.x + (s.i + 0.5) * pitch),
      h: r1((s.steps / peak) * box.h),
      over: s.steps >= TEN_THOUSAND,
      tallest,
    };
  });
  return { trees, line: r1(base - (TEN_THOUSAND / peak) * box.h), over: trees.filter((t) => t.over).length, pitch: r1(pitch) };
}

export type Band = 'high' | 'mid' | 'low';

/**
 * Thirty lanterns on a string sagging between two posts, sorted by band (the
 * good mornings first), never dated: the record keeps counts, not days.
 */
export function lanterns(
  r: HealthShowcase['recovery30'],
  from: [number, number],
  to: [number, number],
  sag: number,
): Array<{ x: number; y: number; band: Band }> {
  if (!r) return [];
  const bands: Band[] = [
    ...Array<Band>(Math.max(0, r.high)).fill('high'),
    ...Array<Band>(Math.max(0, r.mid)).fill('mid'),
    ...Array<Band>(Math.max(0, r.low)).fill('low'),
  ];
  const n = bands.length;
  return bands.map((band, i) => {
    const t = (i + 0.5) / n;
    return {
      x: r1(from[0] + (to[0] - from[0]) * t),
      y: r1(from[1] + (to[1] - from[1]) * t + sag * 4 * t * (1 - t)),
      band,
    };
  });
}

/** The string itself, as a quadratic curve with the same sag. */
export function stringPath(from: [number, number], to: [number, number], sag: number): string {
  const cx = (from[0] + to[0]) / 2;
  const cy = (from[1] + to[1]) / 2 + sag * 2;
  return `M${from[0]},${from[1]} Q${r1(cx)},${r1(cy)} ${to[0]},${to[1]}`;
}

/** Hours of sleep at which the moon is full. */
export const MOON_FULL_HOURS = 8;

/**
 * The moon's lit part for a week's average sleep: full at MOON_FULL_HOURS,
 * a waxing crescent below. Null for no reading (the moon is then an outline).
 */
export function moon(hours: number | null | undefined, cx: number, cy: number, r: number): { share: number; d: string } | null {
  if (hours == null || !(hours >= 0)) return null;
  const f = clamp(hours / MOON_FULL_HOURS, 0, 1);
  if (f <= 0) return { share: 0, d: '' };
  if (f >= 1) return { share: 1, d: `M${cx},${cy - r} A${r},${r} 0 1 1 ${cx},${cy + r} A${r},${r} 0 1 1 ${cx},${cy - r} Z` };
  const rx = r1(Math.abs(1 - 2 * f) * r);
  // The lit right limb, top to bottom, then the terminator back up.
  const sweep = f < 0.5 ? 0 : 1;
  return { share: Math.round(f * 100) / 100, d: `M${cx},${cy - r} A${r},${r} 0 0 1 ${cx},${cy + r} A${rx},${r} 0 0 ${sweep} ${cx},${cy - r} Z` };
}

/**
 * Today's steps an hour to a bar: the feed's quarter-hour bins summed four at
 * a time, null for every hour after now. Null when nothing has come in today.
 */
export function hourly(s: StepsToday | null | undefined): Array<number | null> | null {
  if (!s || s.total == null) return null;
  const nowHour = Math.floor(clamp(s.nowBin, 0, 95) / 4);
  return Array.from({ length: 24 }, (_, h) => {
    if (h > nowHour) return null;
    let t = 0;
    for (let k = 0; k < 4; k++) t += Math.max(0, s.bins[h * 4 + k] ?? 0);
    return t;
  });
}

/**
 * Contour lines for a hillside: `n` gentle, seeded waves across the scene
 * between `top` and `bottom`, for texture only.
 */
export function contours(n: number, top: number, bottom: number, seed: number): string[] {
  const rnd = seeded(seed);
  const count = Math.max(0, Math.floor(n));
  return Array.from({ length: count }, (_, i) => {
    const y0 = top + ((i + 0.5) / count) * (bottom - top);
    const a = 4 + rnd() * 9;
    const f = 1.2 + rnd() * 1.8;
    const ph = rnd() * Math.PI * 2;
    const pts: Array<[number, number]> = Array.from({ length: 13 }, (_, k) => {
      const x = (k / 12) * SCENE_W;
      return [r1(x), r1(y0 + a * Math.sin((k / 12) * Math.PI * f + ph) + a * 0.4 * Math.sin(k * 1.7 + ph))];
    });
    // Run on past both edges, so on a wide screen the hillside never stops short.
    return `M-2000,${pts[0][1]} L${smoothPath(pts).slice(1)} L3000,${pts[pts.length - 1][1]}`;
  });
}

/* ------------------------------------------------------------------ house */

/**
 * A block of lit windows, one per doorway, `cols` across, filled from the top
 * row down; each lights as the headline count passes it.
 */
export function windows(n: number | null | undefined, cols: number, box: Box): Array<{ x: number; y: number; w: number; h: number; d: number }> {
  const count = Math.max(0, Math.round(n ?? 0));
  if (!count) return [];
  const rows = Math.ceil(count / cols);
  const px = box.w / cols;
  const py = box.h / rows;
  const w = r1(px * 0.56);
  const h = r1(Math.min(py * 0.58, w * 1.5));
  return Array.from({ length: count }, (_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return { x: r1(box.x + c * px + (px - w) / 2), y: r1(box.y + r * py + (py - h) / 2), w, h, d: countDelay(i, count) };
  });
}

/* ------------------------------------------------------------------ works */

/** Most crates the hook carries; any more are said in words. */
export const CRATE_CAP = 6;

/** Today's deploys as crates stacked on the hook, two to a row, bottom up. */
export function crates(n: number | null | undefined): { boxes: Array<{ x: number; y: number }>; more: number } {
  const count = Math.max(0, Math.round(n ?? 0));
  const shown = Math.min(count, CRATE_CAP);
  const boxes = Array.from({ length: shown }, (_, i) => ({ x: i % 2 === 0 ? -1 : 0, y: -Math.floor(i / 2) }));
  return { boxes, more: count - shown };
}

/** "Mon 15 June", for a past day. */
export function dayWords(iso: string): string {
  return new Date(`${iso}T12:00:00Z`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .replace(',', '');
}

/* =================================================================== copy */
/* copy:start — words only below this line; every figure comes from data. */

const DASH = '—';
const ASIDE = 'not answering just now';

export interface Tag {
  id: string;
  kicker: string;
  /** The figure or word shown large; a dash when it is not in. */
  value: string;
  /** Said instead of `value` when the value is only a dash. */
  spoken?: string;
  unit?: string;
  sub?: string;
  /** What the plate says when this label is open. */
  note: string;
}

/** A figure as a label shows it, or a dash with something to say instead. */
export function figure(n: number | null | undefined, decimals = 0): { value: string; spoken?: string } {
  if (n == null || !Number.isFinite(n)) return { value: DASH, spoken: ASIDE };
  return { value: formatFigure(n, decimals) };
}

/** "a", "b and c", "a, b and c". */
export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "one idea", "three ideas", "14 ideas". */
export function plural(n: number, one: string, many: string): string {
  return `${countWord(n)} ${n === 1 ? one : many}`;
}

const BAND_WORD: Record<Band, string> = { high: 'good', mid: 'middling', low: 'low' };
export const bandWord = (b: Band | null | undefined) => (b ? BAND_WORD[b] : null);

/** A label as one line of text, for print and the loose list. */
export function tagLine(t: Tag): string {
  const v = t.spoken ? `${t.spoken}` : [t.value, t.unit].filter(Boolean).join(' ');
  return `${t.kicker} · ${v}${t.sub ? ` (${t.sub})` : ''}`;
}

/* ---- the observatory */

export interface DaydreamWords {
  head: { kicker: string; title: string; unit: string; aside: string };
  key: string;
  rules: string;
  tags: Record<'dome' | 'lookups' | 'struck' | 'useful' | 'shipped' | 'next', Tag>;
}

/**
 * The next think as the observatory says it: the dome's own words where the
 * hero's would only repeat one screen up, the hero's where they are a time.
 */
export function observatoryNext(next: Daydream, hero: { value: string; sub?: string }): { value: string; sub?: string } {
  switch (next.state) {
    case 'off':
      return { value: 'the dome’s shut', sub: 'for now' };
    case 'asleep':
      return { value: 'closed for the night', sub: `opens at ${next.wakes}` };
    case 'now':
      return { value: 'looking up', sub: 'right now' };
    case 'next':
      return { value: hero.value, sub: 'till the dome opens again' };
    default:
      return { value: hero.value, sub: hero.sub };
  }
}

export function daydreamWords(dd: DaydreamShowcase, sky: Pick<Sky, 'drawn' | 'capped'>, next: Daydream, nextWords: { value: string; sub?: string }): DaydreamWords {
  const w = dd.week;
  const im = dd.impact;
  const r = dd.rules;
  const hit = im?.hitRate == null ? null : Math.round(im.hitRate * 100);
  const was = im?.previousHitRate == null ? null : Math.round(im.previousHitRate * 100);
  const way = trend(im?.hitRate, im?.previousHitRate);
  const weeks = im?.weeks.length ?? 0;
  const hours = figure(w?.hours, 1);
  return {
    head: {
      kicker: 'Daydream · the observatory',
      title: 'It thinks while nobody’s watching',
      unit: 'questions it asked itself this week',
      aside: 'It keeps better hours than I do.',
    },
    key:
      w == null
        ? 'The sky is empty because the week’s figures aren’t answering just now, not because it stopped wondering.'
        : sky.capped
          ? `A star for every question it asked itself this week, the first ${formatFigure(sky.drawn)} of them anyway, the rest wouldn’t fit.`
          : `A star for every question it asked itself this week, and the dome lit for the hours it spent thinking.`,
    rules: `A think every ${r.cadenceMinutes} minutes from ${clock(r.activeHours.start)} to ${clock(r.activeHours.end)}, at most ${r.maxLookups} look-ups a think, and never more than ${r.dailyRaiseCap} notes a day raised to me.`,
    tags: {
      dome: {
        id: 'dome',
        kicker: 'In the dome',
        ...hours,
        unit: 'hours thinking',
        sub: w ? `across ${countWord(w.areasCovered)} of ${countWord(r.areas)} areas of life` : undefined,
        note: `The slit is lit for the share of the waking week it spent thinking, and each panel is an area of my life, lit if it looked there this week.`,
      },
      lookups: {
        id: 'lookups',
        kicker: 'Look-ups',
        ...figure(w?.lookups),
        unit: 'this week',
        sub: `never more than ${r.maxLookups} in one think`,
        note: `Before it writes anything down it can go and look things up, and it has to stop at ${r.maxLookups} a think.`,
      },
      struck: {
        id: 'struck',
        kicker: 'Struck out',
        ...figure(w?.struckOut),
        unit: w?.struckOut === 1 ? 'claim' : 'claims',
        sub: 'by its own auditor',
        note:
          'A second pass checks each claim against its source before a note reaches me, and crosses out what it can’t stand behind.' +
          (w?.struckOut === 0 ? ' This week it found nothing to cross out.' : w ? ' Those are the crossed stars.' : ''),
      },
      useful: {
        id: 'useful',
        kicker: 'Worth reading',
        ...(hit == null ? figure(null) : { value: `${formatFigure(hit)}%` }),
        unit: !im ? undefined : im.rated > 0 ? `of ${formatFigure(im.rated)} rated` : 'nothing rated yet',
        sub:
          way == null || was == null
            ? `over ${r.windowDays} days`
            : way === 'level'
              ? `level with the ${r.windowDays} days before`
              : `${way} from ${formatFigure(was)}%`,
        note: `My verdicts, a star a week for the last ${countWord(weeks)} weeks, higher where more notes were useful and bigger where I rated more. I rate them on my phone.`,
      },
      shipped: {
        id: 'shipped',
        kicker: 'Shipped',
        ...figure(im?.shipped),
        unit: im?.shipped === 1 ? 'idea' : 'ideas',
        sub: 'became real code',
        note: im
          ? `I’ve taken up ${formatFigure(im.accepted)} of its ideas so far and ${formatFigure(im.shipped)} ${im.shipped === 1 ? 'has' : 'have'} gone on to ship. They fall as shooting stars, towards the works further down.`
          : 'Ideas it had on its own that went on to ship, drawn as shooting stars when the figures are in.',
      },
      next: {
        id: 'next',
        kicker: 'Next think',
        ...observatoryNext(next, nextWords),
        note:
          next.state === 'asleep'
            ? 'Out of hours the cloud lies low as mist. It starts again in the morning.'
            : next.state === 'off'
              ? 'The cloud is only an outline while the loop is switched off.'
              : 'The cloud fills as the next think nears and rains while one is under way.',
      },
    },
  };
}

/* ---- the long walk */

export interface HealthWords {
  head: { kicker: string; title: string; unit: string; decimals: number; figure: number | null; aside: string };
  key: string;
  tags: Tag[];
}

export function healthWords(
  h: HealthShowcase,
  opts: { bpm: number | null; today: number | null; walkStep: number; overInWindow: number; days: number },
): HealthWords {
  const kmLead = h.stepsYear == null && h.kmYear != null;
  const r = h.recovery30;
  const total = r ? r.high + r.mid + r.low : 0;
  const best = h.bestDay;
  const tags: Tag[] = [
    {
      id: 'km',
      kicker: 'On foot',
      ...figure(h.kmYear, 1),
      unit: 'km this year',
      sub: best ? `best day ${formatFigure(best.steps)} steps, ${dayWords(best.date)}` : undefined,
      note:
        `The path is every kilometre I’ve walked or run since January, starting far off on the left` +
        (opts.walkStep > 0 ? `, with a post every ${formatFigure(opts.walkStep)} km` : '') +
        '.',
    },
    {
      id: 'over',
      kicker: `Over ${formatFigure(TEN_THOUSAND)}`,
      ...figure(h.daysOver10k),
      unit: h.daysOver10k === 1 ? 'day this year' : 'days this year',
      sub: h.steps30?.length ? `${countWord(opts.overInWindow)} of the last ${opts.days}` : undefined,
      note: `A tree for each of the last ${opts.days} days with readings, as tall as its steps. The ones over the dashed line made ${formatFigure(TEN_THOUSAND)}, and the tallest has a light on top. A gap is a day the phone didn’t send.`,
    },
    {
      id: 'recovery',
      kicker: 'Recovery',
      ...figure(r ? r.high : null),
      unit: r ? `good of ${total}` : undefined,
      sub: r
        ? `${countWord(r.mid)} middling, ${countWord(r.low)} low${h.bands.recovery ? ` · today ${bandWord(h.bands.recovery)}` : ''}`
        : undefined,
      note: 'A lantern for each morning’s recovery reading over the last month, sorted rather than dated. Lit for good, half-lit for middling and dark for low, so the shape says it as well as the colour.',
    },
    {
      id: 'sleep',
      kicker: 'Sleep',
      ...figure(h.sleepAvg7, 1),
      unit: 'hours a night',
      sub: `the last seven${h.bands.sleep ? ` · last night ${bandWord(h.bands.sleep)}` : ''}`,
      note: `The moon fills towards full at ${countWord(MOON_FULL_HOURS)} hours a night, naps not included.`,
    },
    // Today is a flourish: with no steps in yet it is left out, never said,
    // unless a fresh pulse has something to show at the cottage instead.
    ...(opts.today == null && opts.bpm == null ? [] : [todayTag(opts.today, opts.bpm)]),
  ];
  return {
    head: {
      kicker: 'Health · the long walk',
      title: 'My body, on the record',
      unit: kmLead ? 'km on foot this year' : 'steps since January',
      decimals: kmLead ? 1 : 0,
      figure: kmLead ? h.kmYear : h.stepsYear,
      aside: 'Most of it was to the kettle and back.',
    },
    key: 'The year on foot comes down the hill as one long path, the last month standing beside it as trees.',
    tags,
  };
}

/** The cottage's label: today's steps (with the pulse under them when fresh), or the pulse alone. */
function todayTag(today: number | null, bpm: number | null): Tag {
  const glow = ' The cottage window glows with my pulse as the watch last read it.';
  if (today == null) return { id: 'today', kicker: 'Pulse', ...figure(bpm), unit: 'bpm', note: glow.trim() };
  return {
    id: 'today',
    kicker: 'Today',
    ...figure(today),
    unit: 'steps so far',
    sub: bpm != null ? `pulse ${formatFigure(bpm)} bpm` : undefined,
    note: 'Today on foot, an hour to a bar since midnight, nothing drawn after now.' + (bpm != null ? glow : ''),
  };
}

/* ---- the house with a light on */

export interface AppWords {
  head: { kicker: string; title: string; unit: string; aside: string };
  key: string;
  pairing: string;
  tags: Tag[];
}

export function appWords(a: AppShowcase): AppWords {
  const home = a.widgets.filter((w) => w.surface === 'home-screen').map((w) => w.name);
  const readiness = a.complications.find((c) => /readiness/i.test(c.name));
  const quoted = a.intents.map((i) => `“${i.title}”`);
  const games = a.games;
  return {
    head: {
      kicker: 'The SR App · the house with a light on',
      title: 'It lives in my pocket',
      unit: 'doorways from the app into the site',
      aside: 'It goes everywhere I go, which is mostly the kitchen.',
    },
    key: 'Every window in the block is a doorway the app can knock on, lit one by one. The phone and the watch on the sill do the knocking.',
    pairing: `A new phone gets in with a code that dies in ${countWord(a.pairCodeMinutes)} minutes, and the key it’s given lasts ${formatFigure(a.deviceTokenDays)} days.`,
    tags: [
      {
        id: 'phone',
        kicker: 'iPhone',
        ...figure(a.tabs),
        unit: a.tabs === 1 ? 'tab' : 'tabs',
        sub: a.tabNames.join(', '),
        note: 'A tab for each part of the site I use most. The Daydream inbox lives under More, a button for useful and one for not, which is where the percentage in the observatory comes from.',
      },
      {
        id: 'watch',
        kicker: 'Apple Watch',
        value: readiness ? readiness.name : formatFigure(a.watchPages),
        unit: readiness ? undefined : 'pages',
        sub: readiness ? 'the same number as the health page' : undefined,
        note: `The watch has ${countWord(a.watchPages)} pages of its own and ${plural(a.complications.length, 'complication', 'complications')} for the watch face. ${readiness ? `${readiness.name} shows the same number as the health page, from the same reading.` : ''}`.trim(),
      },
      {
        id: 'siri',
        kicker: 'Siri',
        ...figure(a.intents.length),
        unit: a.intents.length === 1 ? 'phrase' : 'phrases',
        sub: listWords(quoted),
        note: `Say ${listWords(quoted)} to Siri, or press the Action button, and it happens without the app being opened.`,
      },
      {
        id: 'lock',
        kicker: 'Lock Screen',
        value: a.liveActivities ? 'Live Activity' : formatFigure(a.widgets.length),
        unit: a.liveActivities ? undefined : 'widgets',
        sub: home.length ? `and ${listWords(home)} on the Home Screen` : undefined,
        note: 'A trip in progress shows on the Lock Screen, updated by push from the site, which decides every word. The family widgets sit on the Home Screen.',
      },
      {
        id: 'games',
        kicker: 'Family games',
        ...figure(games.length),
        unit: games.length === 1 ? 'game' : 'games',
        sub: games.length > 2 ? `${games.slice(0, 2).join(', ')} and ${countWord(games.length - 2)} more` : listWords(games),
        note: `${listWords(games)}. Who played and who won stays in the family.`,
      },
      {
        id: 'areas',
        kicker: 'Parts of the site',
        ...figure(a.nativeAreas),
        sub: `${formatFigure(a.nativeEndpoints)} ${a.nativeEndpoints === 1 ? 'window' : 'windows'} between them`,
        note: `Health, family, chat, games and the rest, ${formatFigure(a.nativeEndpoints)} doorways across ${formatFigure(a.nativeAreas)} parts of the site, each one only opening for a paired phone.`,
      },
    ],
  };
}

/* ---- the works */

export interface WorksWords {
  head: { kicker: string; title: string; unit: string; aside: string };
  key: string;
  tags: Tag[];
}

export function worksWords(b: BuildShowcase, builder: LandingVitals['builder'] | null): WorksWords {
  const since = b.firstDeploy ? dayWords(b.firstDeploy.slice(0, 10)) : null;
  const stage = builder ? (builder.stage || 'idle').toLowerCase() : null;
  return {
    head: {
      kicker: 'Builder · the works',
      title: 'It rewrites itself, then ships',
      unit: 'releases so far',
      aside: 'I mostly hold the ladder.',
    },
    key:
      b.releases == null
        ? 'The edge of town, still going up. The release record isn’t answering just now, so nothing here is counted until it’s back.'
        : 'The edge of town, still going up. The crane lowers today’s deploys onto it, a crate each.',
    tags: [
      {
        id: 'today',
        kicker: 'Today',
        ...figure(b.deploysToday),
        unit: b.deploysToday === 1 ? 'deploy' : 'deploys',
        sub: b.deploysToday == null ? undefined : 'on the hook',
        note: 'A crate on the hook for each deploy today. A deploy is the site swapping itself for a newer copy of itself, while it’s running.',
      },
      {
        id: 'rate',
        kicker: 'Every day',
        ...figure(b.deploysPerDay, 1),
        unit: 'deploys a day',
        sub: b.days == null ? undefined : `over ${formatFigure(b.days)} days`,
        note: since ? `On average, every day since the first deploy on ${since}.` : 'On average, every day since the first deploy.',
      },
      {
        id: 'lines',
        kicker: 'Lines written',
        ...figure(b.linesWritten),
        unit: 'lines',
        sub: b.days == null ? undefined : `in ${formatFigure(b.days)} days`,
        note: 'Lines of code added across every release, mine and the builder’s together.',
      },
      {
        id: 'builder',
        kicker: 'Builder',
        value: stage ?? DASH,
        spoken: stage ? undefined : ASIDE,
        sub: builder ? (builder.active ? 'at it right now' : builder.shippedCount > 0 ? `${formatFigure(builder.shippedCount)} shipped` : undefined) : undefined,
        note: 'The builder takes an idea I’ve accepted, writes the change, tests it and hands it to me to look over. The sign says what it’s doing now.',
      },
      {
        id: 'daydream',
        kicker: 'From Daydream',
        ...figure(b.fromDaydream),
        unit: b.fromDaydream === 1 ? 'idea shipped' : 'ideas shipped',
        sub: 'fell in from the observatory',
        note: 'Ideas Daydream had by itself that made it all the way here.',
      },
    ].filter((t) => (OPTIONAL_WORKS.has(t.id) ? t.value !== DASH : true)),
  };
}

/** Readings the works leaves out when they are not in, rather than draw a row of dashes. */
const OPTIONAL_WORKS = new Set(['today', 'rate', 'lines', 'daydream']);

/* ---- the signpost */

export interface Arm {
  id: string;
  name: string;
  status: string;
  href: string;
}

export function signposts(v: LandingVitals | null, now: number, agoFn: (iso: string | null | undefined, ref: number) => string): Arm[] {
  const c = v?.canvas;
  const jobs = v?.jkai.activeJobs ?? 0;
  const ran = c?.lastRunAt ? agoFn(c.lastRunAt, now) : '';
  return [
    {
      id: 'schedule',
      name: 'Run on a schedule',
      status: c ? `${plural(c.count, 'canvas', 'canvases')}${ran ? ` · ran ${ran}` : ''}` : 'canvases that fire on their own',
      href: '/projects/engine-room',
    },
    {
      id: 'answer',
      name: 'Answer back',
      status: v ? (jobs > 0 ? `${plural(jobs, 'job', 'jobs')} running` : 'quiet right now') : 'the assistant behind it all',
      href: '/projects/engine-room',
    },
    { id: 'family', name: 'Track the family', status: 'private to the family', href: '/projects/engine-room/app' },
  ];
}

/* copy:end */
