// place.ts — the geometry of the landing hero's "place" view: the day drawn as
// a small city under the title, in the light where the owner is.
//
// One skyline, read left to right as then to now: a distant skyline (the
// "ridge") of every release day from the first to six weeks ago, then a street
// of forty buildings, one per day of the last forty (a lit pane per deploy;
// ./place-city), then the tallest tower, whose beacon keeps the last heart
// rate. Today's steps run along the promenade underneath on a day's own scale,
// and the next daydream gathers as a cloud in the sky. The far skyline stops
// where the street begins, so no day is drawn twice. The showcase's works yard
// keeps the older terrace (`town`) below.
//
// Pure: dates and counts in, path strings out, in fixed boxes the view scales
// with CSS (x across 1000 units, y in each layer's own units), so the server
// and the browser draw the same picture at any width and nothing is measured.

import { shipDays, type DayCount } from './rhythm';
import type { Daydream } from './sentence';
import type { StepsToday } from './steps';
import { rulerNow } from './traces';

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Days the terrace holds; the ridge holds everything before them. */
export const TOWN_DAYS = 40;
const DAY_MS = 86_400_000;

/* -------------------------------------------------------------------- sky */

// The sun's position lives in ./sun (the owner's sun is worked out on the
// server from it); re-exported so this module's callers keep one import.
export { sunAltitude } from './sun';

// The sky itself (its colours at every sun altitude, and the light model the
// scenery reads from it) lives in ./sky; re-exported for the same reason.
export { skyAt, skyVars, type Sky, type SkyWord } from './sky';

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** A fixed scatter of stars in a 1000×300 box, kept off the bottom third where the hills are. */
export function starfield(n = 46): Array<[number, number, number]> {
  let seed = 20261009;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => [r1(rnd() * 1000), r1(rnd() * 190), rnd() < 0.15 ? 1.3 : 0.8]);
}

/* ------------------------------------------------------------------ ridge */

export interface Ridge {
  /** The near range of distant towers, filled, in a 1000×100 box with the street at y = 100. */
  d: string;
  /** Their rooftops alone, for the rim light. */
  crest: string;
  /** The farther range behind them: the same days' local highs, softened, so the skyline has depth. */
  far: string;
  /** A scatter of window lights in the near range, for the night (a texture, not a count). */
  lights: string;
  /** Masts on a few of the near roofs, stroked. */
  masts: string;
  /** The highest rooftop in the right-hand third, where the label pins: x in 0..1, y up from the base in 0..1. */
  pin: { x: number; y: number };
  /** First and last day drawn, YYYY-MM-DD. */
  from: string;
  to: string;
  days: number;
}

/** A triangular moving average over ±k, shrinking at the ends. */
function soften(v: number[], k: number): number[] {
  return v.map((_, i) => {
    let s = 0;
    let w = 0;
    for (let j = -k; j <= k; j++) {
      const x = v[i + j];
      if (x == null) continue;
      s += x * (k + 1 - Math.abs(j));
      w += k + 1 - Math.abs(j);
    }
    return s / w;
  });
}

/** A fixed repeatable stream, so the far city's columns stand in the same places every day. */
function stream(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/**
 * Columns across the 1000-wide box, widths between `lo` and `hi`, each as tall
 * as the highest of the days it stands over (`v` in 0..1, one per day).
 */
function columns(v: number[], seed: number, lo: number, hi: number, gaps: number) {
  const rnd = stream(seed);
  const n = v.length;
  const out: Array<{ x: number; w: number; h: number; r: number }> = [];
  for (let x = 0; x < 1000; ) {
    let w = lo + rnd() * (hi - lo);
    if (1000 - (x + w) < lo) w = 1000 - x;
    const a = Math.floor((x / 1000) * n);
    const b = Math.min(n - 1, Math.max(a, Math.ceil(((x + w) / 1000) * n) - 1));
    let h = 0;
    for (let i = a; i <= b; i++) h = Math.max(h, v[i]);
    out.push({ x, w, h, r: rnd() });
    x += w + (rnd() < 0.6 ? gaps * (0.5 + rnd()) : 0);
  }
  return out;
}

/**
 * Releases per day from the first to the day before the near city begins, as
 * a distant skyline: each day's height is √count of the busiest day's, so one
 * huge day reads as a peak rather than flattening the rest. The near range is
 * the days lightly blended (five at a time), stood up as towers, so it reads
 * as a city, not a bar chart; the farther range behind is the same days
 * averaged over a fortnight and raised, so a busy spell stands up behind as a
 * cluster. Null only when no day precedes the city (a record of forty days or
 * fewer): even one earlier day gets its tower, so the plate never claims the
 * city holds days it doesn't.
 */
export function ridge(cadence: DayCount[], todayKey: string): Ridge | null {
  if (!cadence.length) return null;
  const span = Math.round((Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${cadence[0].date}T00:00:00Z`)) / DAY_MS) + 1;
  const days = shipDays(cadence, todayKey, span).slice(0, Math.max(0, span - TOWN_DAYS));
  if (!days.length) return null;
  const peak = Math.sqrt(Math.max(1, ...days.map((d) => d.count)));
  const raw = days.map((d) => Math.sqrt(d.count) / peak);
  const near = soften(raw, 2);
  const farV = soften(raw, 9).map((h, i) => Math.max(Math.min(1, h * 1.4), near[i]));
  const n = near.length;
  const y = (h: number) => r1(100 - 4 - h * 92);
  const box = (x: number, top: number, w: number) => `M${r1(x)},100V${top}H${r1(x + w)}V100Z`;

  const nearCols = columns(near, 7919, 10, 24, 3);
  let d = '';
  let crest = '';
  let lights = '';
  let masts = '';
  for (const c of nearCols) {
    const top = y(c.h);
    // A few step in at the top, as towers do.
    const step = c.r < 0.3 && top < 70 && c.w > 14;
    if (step) {
      const i = c.w * 0.2;
      const sh = r1(Math.min(96, top + 4));
      d += `M${r1(c.x)},100V${sh}H${r1(c.x + i)}V${top}H${r1(c.x + c.w - i)}V${sh}H${r1(c.x + c.w)}V100Z`;
      crest += `M${r1(c.x)},${sh}H${r1(c.x + i)}V${top}H${r1(c.x + c.w - i)}V${sh}H${r1(c.x + c.w)}`;
    } else {
      d += box(c.x, top, c.w);
      crest += `M${r1(c.x)},${top}H${r1(c.x + c.w)}`;
    }
    if (c.r > 0.82 && top < 60) masts += `M${r1(c.x + c.w / 2)},${top}V${r1(Math.max(1, top - 6 - c.r * 6))}`;
    // Windows on a grid, a few lit: rows every 7 units, columns every 5.
    const lit = stream(Math.round(c.x * 31) + 11);
    for (let wy = step ? top + 6 : top + 4; wy < 92; wy += 6)
      for (let wx = c.x + 2.5; wx < c.x + c.w - 2.5; wx += 4) if (lit() < 0.18) lights += `M${r1(wx)},${r1(wy)}h1.4v1.4h-1.4Z`;
  }
  const far = columns(farV, 104729, 14, 34, 2)
    .map((c) => box(c.x, y(c.h), c.w))
    .join('');

  // The pin: the tallest rooftop in the right-hand third.
  let best = nearCols.find((c) => c.x + c.w / 2 >= 660) ?? nearCols[nearCols.length - 1];
  for (const c of nearCols) if (c.x + c.w / 2 >= 660 && c.h > best.h) best = c;
  return {
    d,
    crest,
    far,
    lights,
    masts,
    pin: { x: Math.round(best.x + best.w / 2) / 1000, y: Math.round(4 + best.h * 92) / 100 },
    from: days[0].date,
    to: days[n - 1].date,
    days: n,
  };
}

/* ------------------------------------------------------------------- lamp */

/** How the lamp keeps a rate: dark, lub-dub (two flashes a beat), one flash a beat, or lit and steady. */
export type Lamp = 'dark' | 'lubdub' | 'flash' | 'steady';

/**
 * The lamp never flashes more than three times a second (WCAG 2.3.1), the
 * sentence's rule for its glow: lub-dub up to 90 a minute, a single flash a
 * beat up to 180, and above that it holds steady. Takes the drawn rate.
 */
export function lampFor(drawn: number | null): Lamp {
  if (drawn == null) return 'dark';
  return drawn <= 90 ? 'lubdub' : drawn <= 180 ? 'flash' : 'steady';
}

/* ---------------------------------------------------------------- terrace */

export interface Town {
  /** Lit windows, one per deploy, as little rectangles in a 1000×100 box; every third in a paler lamp. */
  lit: string;
  lit2: string;
  /** The dark windows of the floors nobody deployed on. */
  dark: string;
  /** The houses' outlines, five to a block. */
  blocks: Array<{ x: number; w: number; top: number }>;
  /** Today's house, outlined so a dark today still reads as today. */
  today: { x: number; w: number; top: number };
  /** Windows per storey: 1 unless some day had more deploys than the town has storeys. */
  perFloor: number;
}

const STOREYS = 14;

/**
 * The last forty days as a terrace, a house a day and five houses to a block,
 * oldest on the left. Each deploy lights one window, filled from the ground
 * floor up; a block stands as tall as its busiest day (two storeys at least),
 * so its flat roof is a real height the rambler can stand on. A day busier than
 * fourteen storeys puts two windows (or more) to a floor rather than clip.
 */
export function town(days: DayCount[]): Town {
  const n = days.length || TOWN_DAYS;
  const peak = Math.max(1, ...days.map((d) => d.count));
  const perFloor = Math.ceil(peak / STOREYS);
  const floors = (c: number) => Math.max(2, Math.ceil(c / perFloor));
  const tallest = Math.max(...days.map((d) => floors(d.count)), 2);
  const pitch = Math.min(7.5, 90 / (tallest + 0.6));
  const gap = 4;
  const blockW = (1000 - gap * (n / 5 - 1)) / (n / 5);
  const houseW = blockW / 5;
  const xOf = (i: number) => Math.floor(i / 5) * (blockW + gap) + (i % 5) * houseW;
  const topOf = (f: number) => r1(100 - 4 - f * pitch - 3);
  const win = (x: number, f: number, col: number) => {
    const w = (houseW * 0.5) / perFloor;
    const wx = r1(x + houseW * 0.25 + col * w + (perFloor > 1 ? col * 0.6 : 0));
    const wy = r1(100 - 4 - (f + 1) * pitch + pitch * 0.25);
    return `M${wx},${wy}h${r1(w - (perFloor > 1 ? 0.6 : 0))}v${r1(pitch * 0.5)}h${-r1(w - (perFloor > 1 ? 0.6 : 0))}Z`;
  };
  const blocks: Town['blocks'] = [];
  let lit = '';
  let lit2 = '';
  let dark = '';
  let lamps = 0;
  for (let b = 0; b < n / 5; b++) {
    const group = days.slice(b * 5, b * 5 + 5);
    const f = Math.max(2, ...group.map((d) => floors(d.count)));
    blocks.push({ x: r1(xOf(b * 5)), w: r1(blockW), top: topOf(f) });
    group.forEach((d, k) => {
      const i = b * 5 + k;
      for (let fl = 0; fl < f; fl++)
        for (let c = 0; c < perFloor; c++) {
          const on = fl * perFloor + c < d.count;
          if (on && lamps++ % 3 === 2) lit2 += win(xOf(i), fl, c);
          else if (on) lit += win(xOf(i), fl, c);
          else dark += win(xOf(i), fl, c);
        }
    });
  }
  const last = blocks[blocks.length - 1];
  return { lit, lit2, dark, blocks, today: { x: r1(xOf(n - 1)), w: r1(houseW), top: last.top }, perFloor };
}

/* --------------------------------------------------------------- footpath */

export interface Path {
  /** One mark per walked quarter-hour, as tall as its steps, in a 1000×30 box; the path runs along y = 15. */
  marks: string;
  /** Where now falls, 0..1000; everything right of it is still to come. */
  now: number;
}

/** Today's steps along the promenade: midnight at the left, 23:59 at the right, nothing after now. */
export function footpath(s: StepsToday | null, nowBin: number): Path {
  const now = rulerNow(s?.nowBin ?? nowBin);
  if (!s || s.total == null) return { marks: '', now };
  const peak = Math.max(1, ...s.bins.slice(0, s.nowBin + 1));
  let marks = '';
  s.bins.forEach((v, i) => {
    if (i > s.nowBin || v <= 0) return;
    const x = r1(((i + 0.5) / s.bins.length) * 1000);
    const h = r1(1.5 + (v / peak) * 11.5);
    marks += `M${x},${r1(15 - h)} L${x},${r1(15 + h)} `;
  });
  return { marks: marks.trim(), now };
}

/** The quarter-hour bin `now` falls in, London time; 0 = 00:00–00:15. */
export function binOf(hour: number): number {
  return clamp(Math.floor(hour * 4), 0, 95);
}

/* ------------------------------------------------------------------ cloud */

export type CloudMode = 'rest' | 'gather' | 'rain' | 'late' | 'mist' | 'off';

/**
 * The daydream as a cloud: it fills from the bottom as the next think nears
 * (a cup over the cadence), is full and raining while one is under way, rests
 * empty when the schedule is unknown, lies low as mist out of hours, and is
 * only an outline when the loop is switched off.
 */
export function cloud(d: Daydream, cadenceMinutes: number): { mode: CloudMode; fill: number } {
  switch (d.state) {
    case 'next':
      return { mode: 'gather', fill: Math.round(clamp(1 - d.minutes / Math.max(1, cadenceMinutes), 0.06, 0.94) * 100) / 100 };
    case 'now':
      return { mode: 'rain', fill: 1 };
    case 'late':
      return { mode: 'late', fill: 1 };
    case 'asleep':
      return { mode: 'mist', fill: 0 };
    case 'off':
      return { mode: 'off', fill: 0 };
    case 'unknown':
      return { mode: 'rest', fill: 0 };
  }
}

/* --------------------------------------------------------------- contrast */

/** WCAG contrast of `fg` (with alpha, composited) over an opaque `bg`. */
export function contrast(fg: [number, number, number, number?], bg: string): number {
  const B = hex(bg);
  const a = fg[3] ?? 1;
  const c = [0, 1, 2].map((i) => fg[i]! * a + B[i] * (1 - a));
  const lum = (v: number[]) => {
    const f = (x: number) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]);
  };
  const [hi, lo] = [lum(c), lum(B)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}
