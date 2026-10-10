// showcase-place.ts — the geometry and the words of the landing showcase told
// in the "place" view: the walk down the page through the city under the
// hero's sky. Four hand-built scenes and a wayfinding sign. (The towers
// behind them and the city's colours in the hero's light: showcase-city.ts.)
//
//   the observatory   Daydream: a star for every question it asked itself
//                     this week, a constellation of twelve weeks of verdicts,
//                     crossed-out stars for the claims its auditor struck,
//                     shooting stars for the ideas that shipped, and a dome
//                     on a tower's roof lit for the hours it spent thinking.
//   the long walk     Health: an elevated walkway of every kilometre on foot
//                     this year with a marker at each milestone, thirty
//                     street trees for the last thirty days of steps, thirty
//                     festoon lights for the recovery readings, a moon for
//                     the week's sleep.
//   the flat          The app: an office tower of lit panes, a doorway each,
//                     and a flat with a phone on the sill.
//   the works         Shipping: a crane over a site between the towers
//                     lowering today's deploys, and the builder's lit sign.
//
// Every scene is drawn in a 1000-wide box of its own height (SceneBox), so
// the server and the browser draw the same picture and nothing is measured.
// Anything that looks random is seeded. Pure: inputs in, numbers and path
// strings out, every function unit-tested (showcase-place.test.ts). The
// words each scene's labels say are in showcase-place-words.ts.

import { COUNT_MS } from './showcase-motion';
import { TEN_THOUSAND } from './showcase-data';
import type { StepsToday } from './steps';
import type { DaydreamShowcase, HealthShowcase } from './showcase';


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
