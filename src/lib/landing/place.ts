// place.ts — the geometry of the landing hero's "place" view: the day drawn as
// a small dusk landscape under the title.
//
// One horizon, read left to right as then to now: a ridge of every release day
// from the first to six weeks ago, then a terrace of forty houses, one per day
// of the last forty (a lit window per deploy), then a lighthouse whose lamp
// keeps the last heart rate. Today's steps run along the shore underneath on a
// day's own scale, and the next daydream gathers as a cloud in the sky. The
// ridge stops where the town begins, so no day is drawn twice.
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

/**
 * The sun's altitude in degrees for an instant, over the north of England
 * (about 54.5°N, 1.5°W). Low-precision solar position, good to a fraction of a
 * degree, which is all a sky colour needs. The place is approximate on purpose:
 * the town in the dateline is the only location the page shows.
 */
export function sunAltitude(ms: number, lat = 54.5, lon = -1.5): number {
  const rad = Math.PI / 180;
  const d = ms / DAY_MS - 10957.5; // days from J2000
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 3.6e-7 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  const la = lat * rad;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / rad;
}

export interface Sky {
  /** Three stops, zenith to horizon, as #rrggbb. */
  top: string;
  mid: string;
  low: string;
  /** "night", "dawn", "sunrise", "daylight", "sunset", "dusk". */
  word: string;
  /** How much of the starfield shows, 0..1. */
  stars: number;
}

// Clamped dark at every hour so cream type keeps its contrast (place.test.ts
// checks every stop): only the low sky warms at the turn of the day, and the
// daytime sky is a deep slate rather than blue.
const STOPS: Array<[number, [string, string, string]]> = [
  [-16, ['#0b0806', '#100c0a', '#161114']],
  [-9, ['#0d0907', '#140f0d', '#231512']],
  [-3, ['#0f0b09', '#1a120f', '#381c12']],
  [3, ['#11100e', '#1f1712', '#40221a']],
  [16, ['#0f1719', '#142023', '#1c2c2f']],
];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function mix(a: string, b: string, t: number): string {
  const A = hex(a);
  const B = hex(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** The sky for a sun altitude; `morning` picks dawn over dusk for the same light. */
export function skyAt(alt: number, morning: boolean): Sky {
  let i = 0;
  while (i < STOPS.length - 1 && alt >= STOPS[i + 1][0]) i++;
  const [a0, A] = STOPS[i];
  const [b0, B] = STOPS[Math.min(i + 1, STOPS.length - 1)];
  const t = b0 === a0 ? 0 : clamp((alt - a0) / (b0 - a0), 0, 1);
  const [top, mid, low] = A.map((c, k) => mix(c, B[k], t));
  const word = alt > 6 ? 'daylight' : alt > -1 ? (morning ? 'sunrise' : 'sunset') : alt > -12 ? (morning ? 'dawn' : 'dusk') : 'night';
  return { top, mid, low, word, stars: Math.round(clamp((-alt - 4) / 10, 0, 1) * 100) / 100 };
}

/** A fixed scatter of stars in a 1000×300 box, kept off the bottom third where the hills are. */
export function starfield(n = 46): Array<[number, number, number]> {
  let seed = 20261009;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => [r1(rnd() * 1000), r1(rnd() * 190), rnd() < 0.15 ? 1.3 : 0.8]);
}

/* ------------------------------------------------------------------ ridge */

export interface Ridge {
  /** The near range, filled, in a 1000×100 box with its baseline at y = 100. */
  d: string;
  /** Its crest alone, for the rim light. */
  crest: string;
  /** The far range behind it: the same days' local highs, softened, so the ridge has depth. */
  far: string;
  /** Two fainter contours under the near crest, the same profile lowered, like an engraving's strata. */
  strata: string;
  /** The highest crest point in the right-hand third, where the label pins: x in 0..1, y up from the base in 0..1. */
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

/**
 * Releases per day from the first to the day before the terrace begins, as a
 * mountain ridge: each day's height is √count of the busiest day's, so one
 * huge day reads as a peak rather than flattening the rest. The near range is
 * the days lightly blended (five at a time) so it reads as land, not a bar
 * chart; the far range behind is the same days averaged over a fortnight and
 * raised, so a busy spell stands up behind as a massif. Null only when no day
 * precedes the town (a record of forty days or fewer): even one earlier day
 * gets its peak, so the plate never claims the town holds days it doesn't.
 */
export function ridge(cadence: DayCount[], todayKey: string): Ridge | null {
  if (!cadence.length) return null;
  const span = Math.round((Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${cadence[0].date}T00:00:00Z`)) / DAY_MS) + 1;
  const days = shipDays(cadence, todayKey, span).slice(0, Math.max(0, span - TOWN_DAYS));
  if (!days.length) return null;
  const peak = Math.sqrt(Math.max(1, ...days.map((d) => d.count)));
  const raw = days.map((d) => Math.sqrt(d.count) / peak);
  const near = soften(raw, 2);
  const far = soften(raw, 9).map((h, i) => Math.max(Math.min(1, h * 1.4), near[i]));
  const n = near.length;
  const xs = near.map((_, i) => r1(((i + 0.5) / n) * 1000));
  const y = (h: number, k = 1) => r1(100 - 4 - h * 92 * k);
  const line = (v: number[], k = 1) => v.map((h, i) => `${i ? 'L' : 'M'}${xs[i]},${y(h, k)}`).join(' ');
  // The foot rises from the baseline at both ends, so the ridge sits on the land.
  const fill = (v: number[]) => `M0,100 L0,96 ${line(v).replace(/^M/, 'L')} L1000,96 L1000,100 Z`;
  let best = Math.floor(n * 0.66);
  for (let i = best; i < n; i++) if (near[i] > near[best]) best = i;
  return {
    d: fill(near),
    crest: line(near),
    far: fill(far),
    strata: `${line(near, 0.62)} ${line(near, 0.3)}`,
    pin: { x: Math.round(xs[best]) / 1000, y: Math.round(4 + near[best] * 92) / 100 },
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

/** Today's steps along the shore: midnight at the left, 23:59 at the right, nothing after now. */
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
