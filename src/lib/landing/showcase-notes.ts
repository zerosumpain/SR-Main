// showcase-notes.ts — the notes view's showcase: the rest of the notebook
// below the hero's ink cover, in words and in pen strokes.
//
// The hero is the cover, an ink sheet of marginalia. Below it the notebook
// opens onto cream pages, ruled in petrol with a red-orange margin, and each
// chapter (Daydream, the health record, the app, the builder, and the rest) is
// a page of hand-inked readings: tallies, a shaded clock, scribbled-out lines,
// a ring drawn round a percentage, pencil bar charts on graph paper, a doodled
// moon, a patent-style sketch of the phone and the watch, a ticked checklist
// and a sticky note.
//
// Everything here is pure and seeded with the hero's pen (notes-ink.ts), so
// the server and the browser draw the same wobble and hydration never
// redraws. Copy rules this file keeps (pinned in showcase-notes.test.ts):
//   - no digit is written into the copy, every figure comes from data;
//   - en-GB grouping, the real minus sign, no "!" and no colons in prose;
//   - null is a dash with words a screen reader says instead, never a zero;
//   - counts, totals, ratios and bands only, and nothing that tells anyone
//     where somebody is, or that they are away (a stale pulse is not mentioned).

import type { AppShowcase, DaydreamShowcase, HealthShowcase, ShowcaseProps } from './showcase';
import { formatFigure } from './showcase-motion';
import { inkLine, inkRing, inkTally, rng, smooth, GATE_PITCH, type Pt } from './notes-ink';
import { agoWords, clock, countWord, londonHour, readDaydream, sinceWords } from './sentence';
import { daydreamReading } from './notes';

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const jit = (r: () => number, amp: number) => (r() * 2 - 1) * amp;
const ok = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/* ------------------------------------------------------------- the figures */

/** A figure as the notebook inks it: the value, or a dash and what is said instead. */
export interface Fig {
  value: string;
  /** Read by a screen reader in place of a dash. */
  spoken?: string;
  /** The number itself, for a count-up; null with a dash. */
  n: number | null;
  decimals: number;
}

/** en-GB figure, or a dash that says why. Never a zero for a missing number. */
export function fig(n: number | null | undefined, decimals = 0, spoken = 'not answering just now'): Fig {
  if (!ok(n)) return { value: '—', spoken, n: null, decimals };
  return { value: formatFigure(n, decimals), n, decimals };
}

/** A share (0..1) as a whole percentage, or null. */
export function percent(rate: number | null | undefined): number | null {
  return ok(rate) ? Math.round(clamp(rate, 0, 1) * 100) : null;
}

/** Plural by count, for units ("question" or "questions"). */
export const plural = (n: number | null, one: string, many: string) => (n === 1 ? one : many);

/** "up from 64%", "down from 81%", "level with the month before", or null without both. */
export function trendWords(cur: number | null, prev: number | null): { dir: 'up' | 'down' | 'level'; words: string } | null {
  const a = percent(cur);
  const b = percent(prev);
  if (a == null || b == null) return null;
  if (a === b) return { dir: 'level', words: 'level with the month before' };
  return a > b ? { dir: 'up', words: `up from ${b}%` } : { dir: 'down', words: `down from ${b}%` };
}

/** "15 Jun", in London's calendar, for a YYYY-MM-DD day. */
export function shortDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** `YYYY-MM-DD` shifted by whole days (calendar arithmetic, so clock changes cannot bite). */
export function dayShift(day: string, by: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Roughly how wide a figure sets in the display face, in em: tabular digits
 * about six-tenths of an em, commas and points about a quarter, a percent
 * sign a little under an em, less the face's tight tracking. Close enough to
 * size a ring drawn round the figure on the server, before anything is measured.
 */
export function figureEm(text: string): number {
  let w = 0;
  for (const c of text) w += /\d/.test(c) ? 0.6 : c === '%' ? 0.84 : c === ',' || c === '.' ? 0.27 : c === '—' ? 0.9 : 0.5;
  return r1(Math.max(0.6, w - 0.04 * text.length) * 100) / 100;
}

/**
 * The room a ring needs round a figure `em` wide so it clears the corners of
 * the digits: a quarter of the width either side (an ellipse must be about
 * one and a half times the box it circles), never less than a third of an em.
 */
export const ringPad = (em: number) => Math.round(Math.max(0.34, em * 0.26) * 100) / 100;

/* ----------------------------------------------------------------- the pen */

/** A box drawn by hand: four strokes, the corners a touch over or under. */
export function inkBox(r: () => number, x: number, y: number, w: number, h: number, amp = 0.6): string {
  return [
    inkLine(r, x, y, x + w, y, amp, 0.004),
    inkLine(r, x + w, y, x + w, y + h, amp, 0.008),
    inkLine(r, x + w, y + h, x, y + h, amp, 0.004),
    inkLine(r, x, y + h, x, y, amp, 0.008),
  ].join(' ');
}

/** The plain rectangle under a hand-drawn box, for its wash (the box's own strokes are open). */
export const rectFill = (x: number, y: number, w: number, h: number) => `M${r1(x)},${r1(y)} h${r1(w)} v${r1(h)} h${r1(-w)} Z`;

/** A rounded box drawn in one go, the pen overshooting a little where it meets itself. */
export function inkRound(r: () => number, x: number, y: number, w: number, h: number, rad: number, amp = 0.7): string {
  const k = rad * 0.29;
  const corner = (cx: number, cy: number, sx: number, sy: number): Pt[] => [
    [cx + sx * rad, cy],
    [cx + sx * k, cy + sy * k],
    [cx, cy + sy * rad],
  ];
  // Clockwise from the top edge's middle.
  const raw: Pt[] = [
    [x + w / 2, y],
    ...corner(x + w, y, -1, 1),
    [x + w, y + h / 2],
    ...corner(x + w, y + h, -1, -1).reverse(),
    [x + w / 2, y + h],
    ...corner(x, y + h, 1, -1),
    [x, y + h / 2],
    ...corner(x, y, 1, 1).reverse(),
    [x + w / 2 + 6, y + 0.6],
  ];
  return smooth(raw.map(([a, b]) => [a + jit(r, amp), b + jit(r, amp)]));
}

/** A hand-drawn arrow, bowed, with a two-stroke head at the far end. */
export function inkArrow(r: () => number, x1: number, y1: number, x2: number, y2: number, bow = 0.18): { shaft: string; head: string } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const b = len * bow;
  const mid: Pt = [x1 + dx / 2 - (dy / len) * b, y1 + dy / 2 + (dx / len) * b];
  const shaft = smooth([[x1, y1], mid, [x2 + jit(r, 0.4), y2 + jit(r, 0.4)]]);
  // The head points along the last stretch of the curve.
  const a = Math.atan2(y2 - mid[1], x2 - mid[0]);
  const s = Math.min(9, len * 0.3);
  const wing = (t: number) => `M${r1(x2 + Math.cos(a + Math.PI - t) * s)},${r1(y2 + Math.sin(a + Math.PI - t) * s)} L${r1(x2)},${r1(y2)}`;
  return { shaft, head: `${wing(0.45 + jit(r, 0.05))} ${wing(-0.45 + jit(r, 0.05))}` };
}

/** A tick, as a marker ticks a box: short down-stroke, long up-stroke. */
export function inkTick(r: () => number, x: number, y: number, s = 14): string {
  return smooth([
    [x + jit(r, 0.4), y + s * 0.5 + jit(r, 0.4)],
    [x + s * 0.36, y + s * 0.9],
    [x + s * 1.05 + jit(r, 0.6), y - s * 0.15 + jit(r, 0.6)],
  ]);
}

/* ----------------------------------------------------------- daydream page */

export interface TallyRow {
  d: string;
  y: number;
  count: number;
}

/** Room for one row of tallies: ten gates, fifty strokes. */
export const TALLY_ROW = 50;
export const TALLY_W = (TALLY_ROW / 5) * GATE_PITCH;
export const TALLY_PITCH = 32;

/**
 * The week's questions as tally gates, fifty to a row. Past `maxRows` rows
 * the rest are owed as "+n" rather than squeezed past counting. Empty for
 * none, so the page can say "none this week" instead of drawing nothing.
 */
export function tallyRows(count: number | null, maxRows = 4, seed = 41): { rows: TallyRow[]; more: number } {
  if (!ok(count) || count <= 0) return { rows: [], more: 0 };
  const n = Math.floor(count);
  const shown = Math.min(n, TALLY_ROW * maxRows);
  const rows: TallyRow[] = [];
  for (let i = 0; i * TALLY_ROW < shown; i++) {
    const c = Math.min(TALLY_ROW, shown - i * TALLY_ROW);
    rows.push({ d: inkTally(c, TALLY_W, 22, seed + i).d, y: i * TALLY_PITCH, count: c });
  }
  return { rows, more: n - shown };
}

/** Share of the waking week spent thinking, 0..1, or null. */
export function thinkingShare(hours: number | null | undefined, active: { start: number; end: number }): number | null {
  const awake = (active.end - active.start) * 7;
  if (!ok(hours) || !(awake > 0)) return null;
  return clamp(hours / awake, 0, 1);
}

/** The clock face: a hand-drawn rim, twelve ticks and the hours hatched as a wedge from twelve. */
export function clockFace(share: number | null, seed = 53): { face: string; ticks: string; wedge: string | null; rim: string } {
  const r = rng(seed);
  const cx = 40;
  const cy = 40;
  const face = inkRing(r, cx, cy, 33, 33, 1.06, 0.025);
  const rim = inkRing(r, cx, cy, 36.5, 36.5, 1.02, 0.02);
  let ticks = '';
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const inner = i % 3 === 0 ? 25 : 28;
    ticks += `M${r1(cx + Math.sin(a) * inner + jit(r, 0.3))},${r1(cy - Math.cos(a) * inner + jit(r, 0.3))} L${r1(cx + Math.sin(a) * 31)},${r1(cy - Math.cos(a) * 31)} `;
  }
  let wedge: string | null = null;
  if (share != null && share > 0) {
    const t = Math.min(0.999, share);
    const rad = 22;
    const a = t * Math.PI * 2;
    wedge = `M${cx},${cy} L${cx},${cy - rad} A${rad},${rad} 0 ${t > 0.5 ? 1 : 0} 1 ${r1(cx + Math.sin(a) * rad)},${r1(cy - Math.cos(a) * rad)} Z`;
  }
  return { face, ticks: ticks.trim(), wedge, rim };
}

/**
 * Struck-out claims as lines of scribble, each crossed through: the shape of
 * a sentence and never its words. At most `max` lines; the count is the "×n".
 */
export function scribbles(n: number | null, max = 5, seed = 61): { lines: string[]; strikes: string[] } {
  if (!ok(n) || n <= 0) return { lines: [], strikes: [] };
  const lines: string[] = [];
  const strikes: string[] = [];
  const shown = Math.min(Math.floor(n), max);
  for (let i = 0; i < shown; i++) {
    const r = rng(seed + i * 7);
    const y = 9 + i * 18;
    const w = 96 + r() * 70;
    const pts: Pt[] = [];
    // Cursive-ish loops: an up-and-down run with now and then a taller letter.
    for (let x = 4; x <= w; x += 5) pts.push([x, y + (pts.length % 2 ? 2.5 : -2.5) * (r() > 0.85 ? 2 : 1) + jit(r, 0.8)]);
    lines.push(smooth(pts));
    // The crossing-out: a tight zigzag back and forth over the line.
    const z: Pt[] = [];
    for (let x = 2; x <= w + 4; x += 7) z.push([x + jit(r, 1), y + (z.length % 2 ? 3.5 : -3.5) + jit(r, 0.8)]);
    strikes.push(smooth(z));
  }
  return { lines, strikes };
}

/** Boxes for the areas of life, ticked for each one covered this week. */
export function areaBoxes(covered: number | null, areas: number): Array<{ on: boolean; box: string; tick: string | null }> {
  const n = Math.max(0, Math.floor(areas));
  const c = ok(covered) ? clamp(Math.floor(covered), 0, n) : 0;
  return Array.from({ length: n }, (_, i) => {
    const r = rng(71 + i);
    const x = i * 26 + 2;
    return { on: i < c, box: inkBox(r, x, 6, 18, 18, 0.5), tick: i < c ? inkTick(r, x + 2, 6, 16) : null };
  });
}

/** A hand-drawn box and the plain rectangle that carries its wash. */
export interface InkSeg {
  d: string;
  fill: string;
}

export interface VerdictCol {
  x: number;
  start: string;
  /** Wobbly boxes, bottom up: useful, not useful, undecided; null when the week has none. */
  useful: InkSeg | null;
  notUseful: InkSeg | null;
  undecided: InkSeg | null;
  total: number;
}

/**
 * Twelve weeks of verdicts as pencil columns on a `w` × `h` box: useful at
 * the foot (orange), then not useful (ink), then undecided (dotted pencil),
 * scaled to the busiest week. An empty week stays a bare baseline.
 */
export function verdictCols(weeks: Array<{ start: string; useful: number; notUseful: number; undecided: number }>, w: number, h: number, seed = 83): VerdictCol[] {
  if (!weeks.length) return [];
  const peak = Math.max(1, ...weeks.map((k) => k.useful + k.notUseful + k.undecided));
  const pitch = w / weeks.length;
  const bw = Math.max(6, pitch * 0.56);
  return weeks.map((k, i) => {
    const r = rng(seed + i);
    const x = i * pitch + (pitch - bw) / 2;
    let y = h;
    const seg = (v: number): InkSeg | null => {
      if (!(v > 0)) return null;
      const sh = (v / peak) * (h - 4);
      y -= sh;
      return { d: inkBox(r, x, y, bw, sh, 0.5), fill: rectFill(x, y, bw, sh) };
    };
    const useful = seg(k.useful);
    const notUseful = seg(k.notUseful);
    const undecided = seg(k.undecided);
    return { x: r1(x), start: k.start, useful, notUseful, undecided, total: k.useful + k.notUseful + k.undecided };
  });
}

/** The verdicts chart in one sentence. */
export function verdictSentence(weeks: Array<{ useful: number; notUseful: number; undecided: number }>): string {
  if (!weeks.length) return 'No verdicts to draw yet.';
  const t = weeks.reduce((a, k) => ({ u: a.u + k.useful, n: a.n + k.notUseful, d: a.d + k.undecided }), { u: 0, n: 0, d: 0 });
  return `Over the last ${countWord(weeks.length)} weeks I marked ${formatFigure(t.u)} of its notes useful and ${formatFigure(t.n)} not, with ${formatFigure(t.d)} still waiting on me.`;
}

/** The fixed rules, in the order a reader would ask about them. */
export function ruleLines(rules: DaydreamShowcase['rules']): string[] {
  return [
    `a think every ${formatFigure(rules.cadenceMinutes)} minutes, ${clock(rules.activeHours.start)} to ${clock(rules.activeHours.end)}`,
    `up to ${countWord(rules.slotsPerDay)} thinks a day`,
    `at most ${countWord(rules.maxLookups)} look-ups a think`,
    `at most ${countWord(rules.maxNotes)} notes a think, and ${countWord(rules.dailyRaiseCap)} raised to me a day`,
  ];
}

/** Where an hour of the day sits on a twenty-four hour face: midnight at the top, clockwise. */
const hourAngle = (h: number) => (h / 24) * Math.PI * 2;

/**
 * A twenty-four hour face for the day's thinking: a hand-drawn rim, a tick an
 * hour (longer at the quarters), its waking hours hatched as a wedge, a dot
 * at each of the day's think slots, and the hour hand at `nowHour` (London),
 * or no hand without one. Drawn on an 80 by 80 box.
 */
export function dayFace(rules: DaydreamShowcase['rules'], nowHour: number | null, seed = 257) {
  const r = rng(seed);
  const [cx, cy] = [40, 40];
  const at = (h: number, rad: number): Pt => [r1(cx + Math.sin(hourAngle(h)) * rad), r1(cy - Math.cos(hourAngle(h)) * rad)];
  const rim = inkRing(r, cx, cy, 36, 36, 1.05, 0.02);
  let ticks = '';
  for (let h = 0; h < 24; h++) {
    const [x1, y1] = at(h, h % 6 === 0 ? 28 : 31);
    const [x2, y2] = at(h, 34);
    ticks += `M${r1(x1 + jit(r, 0.25))},${r1(y1 + jit(r, 0.25))} L${x2},${y2} `;
  }
  const { start, end } = rules.activeHours;
  const span = Math.max(0, end - start);
  let wedge: string | null = null;
  if (span > 0 && span < 24) {
    const rad = 25;
    const [sx, sy] = at(start, rad);
    const [ex, ey] = at(end, rad);
    wedge = `M${cx},${cy} L${sx},${sy} A${rad},${rad} 0 ${span > 12 ? 1 : 0} 1 ${ex},${ey} Z`;
  }
  const slots: Pt[] = [];
  const step = rules.cadenceMinutes / 60;
  if (step > 0) for (let i = 0; i < Math.min(rules.slotsPerDay, 96); i++) slots.push(at(start + i * step, 31.5));
  const hand = nowHour == null || !Number.isFinite(nowHour) ? null : inkLine(r, cx, cy, ...at(nowHour, 22), 0.2, 0.01);
  return { rim, ticks: ticks.trim(), wedge, slots, hand };
}

/** The face in one sentence. */
export function dayFaceSentence(rules: DaydreamShowcase['rules']): string {
  return `A day on one clock face, its waking hours from ${clock(rules.activeHours.start)} to ${clock(rules.activeHours.end)} hatched, with a dot for each of its ${countWord(rules.slotsPerDay)} chances to think.`;
}

/** The forward reference from Daydream to the builder's sticky note. */
export function shippedAside(n: number | null | undefined): string | null {
  return ok(n) && n > 0 ? `${countWord(n)} of its ideas ${n === 1 ? 'has' : 'have'} shipped as code, three pages on.` : null;
}

/* ------------------------------------------------------------- health page */

export interface StepBar {
  /** Its place in the window, oldest first. */
  i: number;
  steps: number;
  x: number;
  y: number;
  /** The wobbly outline of the bar. */
  d: string;
  /** The rectangle under it, for its wash. */
  fill: string;
  best: boolean;
}

export interface StepChart {
  bars: StepBar[];
  /** The ten-thousand line's height, in px from the top. */
  tenK: number;
  line: string;
  /** The ring round the best day in the window, or null. */
  ring: string | null;
  /** Where its handwritten figure goes, in the chart's units, and on which side of the ring. */
  bestAt: { x: number; y: number; side: 'left' | 'right'; steps: number } | null;
  slot: number;
}

/**
 * The window's days (oldest first, ending on the latest complete day with
 * readings) as wobbly ink bars on graph paper, `w` × `h`. A day with no
 * readings is left out, not drawn as zero; the latest always stands at the
 * right. The best day in the window is ringed and ten thousand is dashed.
 */
export function stepChart(days: Array<number | null> | null, w: number, h: number, n = 30, seed = 97): StepChart | null {
  if (!days?.length) return null;
  const slice = days.slice(-n);
  const off = n - slice.length;
  const inside = slice
    .map((steps, i) => ({ i: i + off, steps }))
    .filter((d): d is { i: number; steps: number } => d.steps != null && ok(d.steps) && d.steps >= 0);
  if (!inside.length) return null;
  const peak = Math.max(11_000, ...inside.map((d) => d.steps)) * 1.08;
  const slot = w / n;
  const bw = slot * 0.62;
  const yOf = (v: number) => h - (v / peak) * h;
  const best = inside.reduce((b, d) => (d.steps > b.steps ? d : b), inside[0]);
  const bars = inside.map((d) => {
    const r = rng(seed + d.i);
    const x = d.i * slot + (slot - bw) / 2;
    const y = yOf(d.steps);
    return { i: d.i, steps: d.steps, x: r1(x), y: r1(y), d: d.steps > 0 ? inkBox(r, x, y, bw, h - y, 0.45) : '', fill: d.steps > 0 ? rectFill(x, y, bw, h - y) : '', best: d === best && d.steps > 0 };
  });
  const tenK = r1(yOf(10_000));
  const b = bars.find((x) => x.best);
  // The ring takes in the bar's top and a finger's width of it below.
  const rx = bw / 2 + 9;
  const ring = b ? inkRing(rng(seed + 400), b.x + bw / 2, b.y + 6, rx, 20, 1.12, 0.05) : null;
  const right = b != null && b.x + bw / 2 < w * 0.72;
  const bestAt = b ? { x: r1(right ? b.x + bw / 2 + rx + 6 : b.x + bw / 2 - rx - 6), y: r1(Math.max(0, b.y - 4)), side: right ? ('right' as const) : ('left' as const), steps: b.steps } : null;
  return { bars, tenK, line: inkLine(rng(seed + 500), 0, tenK, w, tenK, 0.4, 0.002), ring, bestAt, slot: r1(slot) };
}

/** The thirty days in one sentence: the range, and how many cleared ten thousand. */
export function stepsSentence(days: Array<number | null> | null): string {
  const real = (days ?? []).filter((d): d is number => d != null && ok(d));
  if (!real.length) return 'No complete days of steps to draw yet.';
  const over = real.filter((d) => d >= 10_000).length;
  const lo = Math.min(...real);
  const hi = Math.max(...real);
  return `Steps on each of the last ${countWord(real.length)} full days with readings, from ${formatFigure(lo)} to ${formatFigure(hi)}, ${countWord(over)} of them over ten thousand.`;
}

/** The quarter-hour of the London day `now` falls in (0..95), for when the phone has sent nothing. */
export function nowBinAt(now: number): number {
  return clamp(Math.floor(londonHour(now) * 4), 0, 95);
}

/**
 * Today's quarter-hour bins summed to the hour: 24 values, null for hours
 * still to come and for every hour when nothing has come in at all (an hour
 * gone without readings is a bare line, never a zero).
 */
export function hourly(bins: number[] | null | undefined, nowBin: number): Array<number | null> {
  const nowHour = Math.floor(clamp(nowBin, 0, 95) / 4);
  return Array.from({ length: 24 }, (_, hr) => {
    if (hr > nowHour) return null;
    if (!bins) return null;
    return bins.slice(hr * 4, hr * 4 + 4).reduce((s, v) => s + (ok(v) && v > 0 ? v : 0), 0);
  });
}

/**
 * Pencil strokes for the hourly bars (`w` × `h`) and the hatch over the hours
 * still to come, after the hour `nowBin` falls in. Hours gone with nothing
 * drawn stay on the bare baseline.
 */
export function hourMarks(hours: Array<number | null>, w: number, h: number, nowBin: number, seed = 131): { strokes: string; hatch: string; now: number } {
  const r = rng(seed);
  const pitch = w / 24;
  const peak = Math.max(1, ...hours.map((v) => v ?? 0));
  let strokes = '';
  hours.forEach((v, i) => {
    if (v == null || !(v > 0)) return;
    const x = i * pitch + pitch / 2;
    const top = h - Math.max(2, (v / peak) * (h - 2));
    for (const dx of [-1.6, 0, 1.6]) strokes += `M${r1(x + dx + jit(r, 0.3))},${h} L${r1(x + dx + jit(r, 0.5))},${r1(top + jit(r, 0.6))} `;
  });
  const now = r1((Math.floor(clamp(nowBin, 0, 95) / 4) + 1) * pitch);
  let hatch = '';
  for (let x = now - h; x < w; x += 6) {
    const sx = Math.max(x, now);
    const ex = Math.min(x + h, w);
    if (ex - sx < 1.5) continue;
    hatch += `M${r1(sx)},${r1(h - (sx - x))} L${r1(ex)},${r1(h - (ex - x))} `;
  }
  return { strokes: strokes.trim(), hatch: hatch.trim(), now };
}

/** The clock hours the "today" axis marks, every HOUR_TICK hours from midnight to midnight. */
export const HOUR_TICK = 6;
export const HOUR_TICKS: number[] = Array.from({ length: 24 / HOUR_TICK + 1 }, (_, i) => i * HOUR_TICK);

/** Today's hours in one sentence. */
export function hourlySentence(hours: Array<number | null>, total: number | null): string {
  // No steps today is never said: it would be a claim about the phone, not the day.
  if (total == null) return 'Today’s steps go in by the hour, midnight to midnight, the hours still to come hatched.';
  const walked = hours.filter((v) => v != null && v > 0).length;
  return `Today so far, ${formatFigure(total)} ${plural(total, 'step', 'steps')} spread over ${countWord(walked)} of the hours gone.`;
}

export type Band = 'high' | 'mid' | 'low';

/** The thirty recovery days as dots, best band first, then any day without a reading. */
export function recoveryDots(mix: HealthShowcase['recovery30'], n = 30): Array<Band | null> {
  if (!mix) return [];
  const out: Array<Band | null> = [];
  for (const b of ['high', 'mid', 'low'] as const) for (let i = 0; i < Math.max(0, Math.floor(mix[b])); i++) out.push(b);
  while (out.length < n) out.push(null);
  return out.slice(0, n);
}

/** A dot's wobbly ring, drawn per cell so no two pencil marks match. */
export function dotRing(i: number, cx: number, cy: number, rad: number): string {
  return inkRing(rng(151 + i), cx, cy, rad, rad, 1.08, 0.06);
}

/** Counts said one way in one sentence: all in words when every one is ten or under, else all in figures. */
function counts(...ns: number[]): string[] {
  return ns.every((n) => n >= 0 && n <= 10) ? ns.map(countWord) : ns.map((n) => formatFigure(n));
}

export interface RecoveryPile {
  band: Band | null;
  count: number;
  dots: Pt[];
  /** The pile's middle, for its label. */
  x: number;
}

/** Dot pitch, piles three dots wide. */
export const REC_PITCH = 24;
const REC_COLS = 3;

/**
 * The thirty days of recovery as piles of dots, one pile per band (green,
 * middling, red, then any days without a reading), each filled bottom up
 * three to a row. Grouped by band and not by date, so it never reads as a
 * calendar.
 */
export function recoveryPiles(mix: HealthShowcase['recovery30'], n = 30): { piles: RecoveryPile[]; w: number; h: number } | null {
  if (!mix) return null;
  const c = { high: Math.max(0, Math.floor(mix.high)), mid: Math.max(0, Math.floor(mix.mid)), low: Math.max(0, Math.floor(mix.low)) };
  const none = Math.max(0, n - c.high - c.mid - c.low);
  const groups: Array<[Band | null, number]> = [
    ['high', c.high],
    ['mid', c.mid],
    ['low', c.low],
  ];
  if (none) groups.push([null, none]);
  const rows = Math.max(1, ...groups.map(([, k]) => Math.ceil(k / REC_COLS)));
  const h = rows * REC_PITCH;
  const pw = REC_COLS * REC_PITCH;
  const piles = groups.map(([band, count], g) => {
    const x0 = g * (pw + REC_PITCH);
    const dots: Pt[] = Array.from({ length: count }, (_, i) => [x0 + (i % REC_COLS) * REC_PITCH + REC_PITCH / 2, h - Math.floor(i / REC_COLS) * REC_PITCH - REC_PITCH / 2]);
    return { band, count, dots, x: x0 + pw / 2 };
  });
  return { piles, w: groups.length * pw + (groups.length - 1) * REC_PITCH, h };
}

export function recoverySentence(mix: HealthShowcase['recovery30']): string {
  if (!mix) return 'No recovery readings to draw yet.';
  const [a, b, c] = counts(mix.high, mix.mid, mix.low);
  return `Of the last thirty days, ${a} were good, ${b} middling and ${c} low, piled up by band rather than by date.`;
}

/** Last night's sleep, as a band in words. */
export function sleepWords(b: Band | null): string | null {
  return b === 'high' ? 'a good one' : b === 'mid' ? 'about average' : b === 'low' ? 'on the short side' : null;
}

/** Today's recovery, as a band in words. */
export function recoveryWords(b: Band | null): string | null {
  return b === 'high' ? 'good' : b === 'mid' ? 'middling' : b === 'low' ? 'low' : null;
}

/**
 * The odometer's wheels: whole kilometres digit by digit, grouped en-GB with
 * a fixed comma between the wheels, then the tenth.
 */
export function odometer(km: number | null): { whole: string[]; tenth: string } | null {
  if (!ok(km) || km < 0) return null;
  const [w, t] = (Math.round(km * 10) / 10).toFixed(1).split('.');
  return { whole: Number(w).toLocaleString('en-GB').split(''), tenth: t };
}

/** Points along a circle from angle `a0` to `a1` (radians, either way round). */
function arc(r: () => number, cx: number, cy: number, rad: number, a0: number, a1: number, n: number, amp: number): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * rad + (i && i < n ? jit(r, amp) : 0), cy + Math.sin(a) * rad + (i && i < n ? jit(r, amp) : 0)] as Pt;
  });
}

/**
 * A crescent moon doodle and a couple of stars: the moon's disc with a
 * second, offset disc bitten out of it, outlined in one pass of the pen.
 */
export function moon(seed = 171): { body: string; stars: string } {
  const r = rng(seed);
  const [x1, y1, R] = [32, 34, 24];
  const [x2, y2, rr] = [44, 26, 21];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  const a = (R * R - rr * rr + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, R * R - a * a));
  const px = x1 + (a * dx) / d;
  const py = y1 + (a * dy) / d;
  const A: Pt = [px + (h * dy) / d, py - (h * dx) / d];
  const B: Pt = [px - (h * dy) / d, py + (h * dx) / d];
  const ang = (cx: number, cy: number, p: Pt) => Math.atan2(p[1] - cy, p[0] - cx);
  // Outer edge: from A to B the long way round, away from the bite.
  const oa = ang(x1, y1, A);
  let ob = ang(x1, y1, B);
  const toBite = Math.atan2(dy, dx);
  const norm = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccwHas = (from: number, to: number, t: number) => norm(t - from) < norm(to - from);
  if (ccwHas(oa, ob, toBite)) ob = oa - norm(oa - ob);
  else ob = oa + norm(ob - oa);
  // Inner edge: back from B to A along the bite, the short way.
  const ia = ang(x2, y2, B);
  let ib = ang(x2, y2, A);
  const toMoon = toBite + Math.PI;
  if (ccwHas(ia, ib, toMoon)) ib = ia + norm(ib - ia);
  else ib = ia - norm(ia - ib);
  const pts = [...arc(r, x1, y1, R, oa, ob, 14, 0.5), ...arc(r, x2, y2, rr, ia, ib, 8, 0.4).slice(1)];
  pts.push([A[0] + 1.5, A[1] + 1.2]);
  const star = (x: number, y: number, s: number) =>
    `M${r1(x - s)},${r1(y + jit(r, 0.3))} L${r1(x + s)},${r1(y + jit(r, 0.3))} M${r1(x + jit(r, 0.3))},${r1(y - s)} L${r1(x + jit(r, 0.3))},${r1(y + s)}`;
  return { body: smooth(pts), stars: `${star(66, 12, 3.5)} ${star(74, 34, 2.5)} ${star(62, 52, 2)}` };
}

/* ---------------------------------------------------------------- app page */

export interface Callout {
  n: number;
  /** Where the numbered circle sits, as a share of the drawing (0..1). */
  at: [number, number];
  /** The leader, in the drawing's own units. */
  leader: { shaft: string; head: string };
  text: string;
  /** Quoted phrases or names under the line, if any. */
  more?: string;
}

/** The sketch's viewBox. */
export const SKETCH_W = 560;
export const SKETCH_H = 420;

/** The patent-style drawing of the phone and the watch, as paths. */
export function deviceSketch(seed = 191) {
  const r = rng(seed);
  const phone = { x: 40, y: 18, w: 200, h: 384 };
  const watch = { x: 330, y: 118, w: 140, h: 168 };
  const games: string[] = [];
  for (let i = 0; i < 10; i++) {
    const gx = 318 + (i % 5) * 34;
    const gy = 336 + Math.floor(i / 5) * 34;
    games.push(inkRound(r, gx, gy, 26, 26, 6, 0.5));
  }
  // Two bars-and-ticks widgets, side by side on the Home Screen.
  const wy = 196;
  const widgetBars = [0.5, 0.8, 0.35, 0.95, 0.6]
    .map((v, i) => inkLine(r, 72 + i * 11, wy + 66, 72 + i * 11, wy + 66 - v * 40, 0.3, 0.01))
    .join(' ');
  const widgetTicks = [0, 1, 2].map((i) => `${inkBox(r, 158, wy + 20 + i * 18, 9, 9, 0.3)} ${i < 2 ? inkTick(r, 158, wy + 20 + i * 18, 10) : ''}`).join(' ');
  // Siri: a small orb and a voice wave across the foot of the screen.
  const wave: Pt[] = [];
  for (let x = 70; x <= 210; x += 5) wave.push([x, 352 + Math.sin(x / 6) * (6 * Math.sin(((x - 70) / 140) * Math.PI)) + jit(r, 0.5)]);
  return {
    phone: inkRound(r, phone.x, phone.y, phone.w, phone.h, 34),
    screen: inkRound(r, phone.x + 10, phone.y + 10, phone.w - 20, phone.h - 20, 26, 0.5),
    island: inkRound(r, phone.x + 72, phone.y + 20, 56, 14, 7, 0.3),
    lockTime: inkLine(r, 100, 74, 180, 74, 0.5, 0.01) + ' ' + inkLine(r, 104, 82, 176, 82, 0.5, 0.01),
    live: inkRound(r, 62, 108, 156, 46, 14, 0.5),
    liveTrack: inkLine(r, 80, 138, 200, 138, 0.3, 0.004),
    liveDot: { cx: 152, cy: 138 },
    widgets: inkRound(r, 62, wy, 74, 74, 12, 0.5) + ' ' + inkRound(r, 144, wy, 74, 74, 12, 0.5),
    widgetBars,
    widgetTicks,
    orb: inkRing(r, 140, 322, 9, 9, 1.08, 0.05),
    wave: smooth(wave),
    home: inkLine(r, 112, 386, 168, 386, 0.3, 0.003),
    watch: inkRound(r, watch.x, watch.y, watch.w, watch.h, 38),
    watchScreen: inkRound(r, watch.x + 12, watch.y + 12, watch.w - 24, watch.h - 24, 28, 0.5),
    strapTop: inkLine(r, watch.x + 28, watch.y, watch.x + 34, watch.y - 70, 0.6, 0.02) + ' ' + inkLine(r, watch.x + watch.w - 28, watch.y, watch.x + watch.w - 34, watch.y - 70, 0.6, 0.02),
    strapBottom:
      inkLine(r, watch.x + 28, watch.y + watch.h, watch.x + 34, watch.y + watch.h + 34, 0.6, 0.02) +
      ' ' +
      inkLine(r, watch.x + watch.w - 28, watch.y + watch.h, watch.x + watch.w - 34, watch.y + watch.h + 34, 0.6, 0.02),
    crown: inkRound(r, watch.x + watch.w, watch.y + 46, 9, 26, 3, 0.3),
    // The ring is left empty and a dash pencilled in it: the drawing has no number to show.
    readiness: inkLine(r, watch.x + watch.w / 2 - 11, watch.y + watch.h / 2, watch.x + watch.w / 2 + 11, watch.y + watch.h / 2, 0.4, 0.02),
    readinessTrack: inkRing(r, watch.x + watch.w / 2, watch.y + watch.h / 2, 34, 34, 1.04, 0.02),
    games,
  };
}

/** The numbered notes on the sketch, from the app's own manifest. Missing parts are left off. */
export function callouts(app: AppShowcase, seed = 211): Callout[] {
  const r = rng(seed);
  const out: Omit<Callout, 'n'>[] = [];
  const A = (x1: number, y1: number, x2: number, y2: number, bow = 0.18) => inkArrow(r, x1, y1, x2, y2, bow);
  const at = (x: number, y: number): [number, number] => [r1((x / SKETCH_W) * 1000) / 1000, r1((y / SKETCH_H) * 1000) / 1000];
  if (app.liveActivities) out.push({ at: at(282, 64), leader: A(268, 70, 222, 120), text: 'A Live Activity on the Lock Screen' });
  const home = app.widgets.filter((w) => w.surface === 'home-screen').map((w) => w.name);
  const all = app.widgets.length;
  if (home.length)
    out.push({
      at: at(282, 196),
      leader: A(268, 200, 222, 226, -0.2),
      text:
        home.length === all
          ? `${home.length === 1 ? 'A widget' : `${capital(countWord(home.length))} widgets`} on the Home Screen`
          : `${capital(countWord(home.length))} of its ${countWord(all)} widgets on the Home Screen`,
      more: home.join(' and '),
    });
  if (app.complications.some((c) => /readiness/i.test(c.name)))
    out.push({ at: at(520, 112), leader: A(508, 124, 438, 190, 0.2), text: 'Readiness on the watch, the same number as on the health page' });
  if (app.intents.length)
    out.push({
      at: at(282, 300),
      leader: A(268, 306, 214, 344, -0.15),
      text: `${capital(countWord(app.intents.length))} things to say to Siri`,
      more: app.intents.map((i) => `“Hey Siri, ${i.title.charAt(0).toLowerCase()}${i.title.slice(1)}”`).join(', '),
    });
  if (app.games.length)
    out.push({ at: at(520, 316), leader: A(516, 330, 488, 344, 0.25), text: `${capital(countWord(app.games.length))} family games`, more: app.games.join(', ') });
  return out.map((c, i) => ({ ...c, n: i + 1 }));
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The stapled receipt: a count per line, counted from the app itself. */
export function receipt(app: AppShowcase): Array<{ k: string; v: string; sub?: string }> {
  const rows: Array<{ k: string; v: string; sub?: string }> = [
    { k: 'parts that install together', v: formatFigure(app.targets) },
    { k: 'tabs', v: formatFigure(app.tabs), sub: app.tabNames.join(' · ') },
    { k: 'watch pages', v: formatFigure(app.watchPages) },
    { k: 'widgets', v: formatFigure(app.widgets.length) },
    { k: 'watch complications', v: formatFigure(app.complications.length) },
    { k: 'Siri phrases', v: formatFigure(app.intents.length) },
    { k: 'family games', v: formatFigure(app.games.length) },
    { k: 'doorways into the site', v: formatFigure(app.nativeEndpoints) },
    { k: 'pairing code dies in', v: `${formatFigure(app.pairCodeMinutes)} min` },
    { k: 'paired key lasts', v: `${formatFigure(app.deviceTokenDays)} days` },
  ];
  return rows;
}

/* -------------------------------------------------------------- build page */

/** The builder's checklist: every step ticked, and the live stage when something is on the bench. */
export function checklist(v: ShowcaseProps['v']): { steps: string[]; bench: { text: string; live: boolean } | null } {
  const steps = ['an idea, mine or Daydream’s, accepted', 'a brief written', 'the change made, on its own branch', 'a preview to look at', 'tests and gates passed', 'shipped, with its notes written up'];
  if (!v) return { steps, bench: null };
  const stage = v.builder.stage?.trim().toLowerCase();
  if (v.builder.active) return { steps, bench: { text: stage && stage !== 'idle' ? `on the bench now, ${stage}` : 'on the bench now', live: true } };
  return { steps, bench: { text: 'the bench is clear just now', live: false } };
}

/** "since March", "since March 2025", or null with no first deploy. */
export function sinceLine(firstDeploy: string | null, days: number | null, now: number): string | null {
  const s = sinceWords(firstDeploy, now);
  if (!s) return null;
  return ok(days) && days > 0 ? `since ${s}, over ${formatFigure(days)} ${plural(days, 'day', 'days')}` : `since ${s}`;
}

/** The average, said loosely. */
export function perDayWords(perDay: number | null): string | null {
  return ok(perDay) && perDay > 0 ? `about ${formatFigure(perDay, perDay < 10 ? 1 : 0)} a day on average` : null;
}

/** Today's deploys as one row of tallies, or nothing for none (the words say so). */
export function deployTally(n: number | null, seed = 233): string | null {
  return ok(n) && n > 0 ? inkTally(n, GATE_PITCH * 8, 22, seed).d : null;
}

/* -------------------------------------------------------------------- coda */

export interface CodaItem {
  id: 'canvas' | 'jkai' | 'family';
  name: string;
  href: string;
  line: string;
  /** Said instead of a dash. */
  spoken?: string;
}

/** The rest of the notebook: three more things it does, with what each is up to. */
export function codaItems(v: ShowcaseProps['v'], now: number): CodaItem[] {
  let canvas: Pick<CodaItem, 'line' | 'spoken'> = { line: '—', spoken: 'not answering just now' };
  if (v) {
    const c = v.canvas.count;
    const ran = v.canvas.lastRunAt && Number.isFinite(Date.parse(v.canvas.lastRunAt)) ? `, the last ran ${agoWords(v.canvas.lastRunAt, now)}` : '';
    canvas = { line: c > 0 ? `${countWord(c)} ${plural(c, 'canvas', 'canvases')} running${ran}` : 'no canvases running just now' };
  }
  let jkai: Pick<CodaItem, 'line' | 'spoken'> = { line: '—', spoken: 'not answering just now' };
  if (v) {
    const j = v.jkai.activeJobs;
    jkai = { line: j > 0 ? `my assistant is busy with ${countWord(j)} ${plural(j, 'job', 'jobs')}` : 'my assistant is quiet just now' };
  }
  return [
    { id: 'canvas', name: 'Run on a schedule', href: '/projects/engine-room', ...canvas },
    { id: 'jkai', name: 'Answer back', href: '/projects/engine-room', ...jkai },
    { id: 'family', name: 'Track the family', href: '/projects/engine-room/app', line: 'private to the family' },
  ];
}

/* --------------------------------------------------------------- fair copy */

export interface FairRow {
  k: string;
  v: string;
}

/** What each of the rules is about, for the typed-up list. */
const RULE_KEYS = ['How often it thinks', 'Thinks a day', 'Look-ups', 'Notes'];

export type FairInput = Pick<ShowcaseProps, 'data' | 'build' | 'pulse' | 'steps' | 'v' | 'now' | 'facts'>;

/**
 * Every reading on the pages typed up, page by page: what each page shows in
 * place of its drawings when the hero's "fair copy" is on, and what prints.
 * A missing figure is a dash; a stale pulse is left out altogether.
 */
export function fairPages(p: FairInput): Record<'daydream' | 'health' | 'app' | 'build' | 'rest', FairRow[]> {
  const { daydream: d, health: h, app } = p.data;
  const f = (n: number | null | undefined, dec = 0) => (ok(n) ? formatFigure(n, dec) : '—');
  const hit = percent(d.impact?.hitRate);
  const trend = trendWords(d.impact?.hitRate ?? null, d.impact?.previousHitRate ?? null);
  const weeks = d.impact?.weeks ?? [];
  const tot = weeks.reduce((a, k) => ({ u: a.u + k.useful, n: a.n + k.notUseful, w: a.w + k.undecided }), { u: 0, n: 0, w: 0 });
  const next = daydreamReading(readDaydream(p.v, p.facts.daydream, p.now), p.facts.daydream);
  const rules = ruleLines(d.rules);

  const daydream: FairRow[] = [
    { k: 'Questions it asked itself this week', v: f(d.week?.questions) },
    { k: 'Hours spent thinking', v: f(d.week?.hours, 1) },
    { k: 'Look-ups made', v: f(d.week?.lookups) },
    { k: 'Claims its auditor struck out', v: f(d.week?.struckOut) },
    { k: 'Areas of life covered', v: d.week ? `${formatFigure(d.week.areasCovered)} of ${formatFigure(d.rules.areas)}` : '—' },
    {
      k: `Rated notes marked useful, the last ${countWord(d.rules.windowDays)} days`,
      v: hit == null || !d.impact ? '—' : `${hit}% of ${formatFigure(d.impact.rated)}${trend ? `, ${trend.words}` : ''}`,
    },
    {
      k: `Verdicts over ${countWord(weeks.length || 12)} weeks`,
      v: weeks.length ? `${formatFigure(tot.u)} useful, ${formatFigure(tot.n)} not, ${formatFigure(tot.w)} waiting` : '—',
    },
    { k: 'Its ideas that shipped as code', v: f(d.impact?.shipped) },
    { k: 'Just now', v: `${next.lead} ${next.value}` },
    ...rules.map((r, i) => ({ k: RULE_KEYS[i] ?? 'And', v: r })),
  ];

  const sleep = sleepWords(h.bands.sleep);
  const ready = recoveryWords(h.bands.recovery);
  const health: FairRow[] = [
    { k: 'Steps this year', v: f(h.stepsYear) },
    { k: 'Kilometres on foot this year', v: f(h.kmYear, 1) },
  ];
  if (p.pulse.state === 'fresh') health.push({ k: 'Heart rate, fresh from the watch', v: `${formatFigure(p.pulse.bpm)} bpm` });
  health.push(
    { k: 'Sleep, average of the last seven nights', v: ok(h.sleepAvg7) ? `${formatFigure(h.sleepAvg7, 1)} hours` : '—' },
    { k: 'Last night’s sleep', v: sleep ?? '—' },
    { k: 'Today’s recovery', v: ready ?? '—' },
    { k: 'Steps today', v: f(p.steps?.total ?? null) },
    {
      k: 'Recovery days in the last thirty',
      v: h.recovery30 ? `${formatFigure(h.recovery30.high)} good, ${formatFigure(h.recovery30.mid)} middling, ${formatFigure(h.recovery30.low)} low` : '—',
    },
    { k: 'Days over ten thousand steps this year', v: f(h.daysOver10k) },
    { k: 'Best day this year', v: h.bestDay ? `${formatFigure(h.bestDay.steps)} steps, ${shortDay(h.bestDay.date)}` : '—' },
  );

  const appRows: FairRow[] = [
    { k: 'Doorways from the app into the site', v: `${formatFigure(app.nativeEndpoints)} across ${formatFigure(app.nativeAreas)} areas` },
    ...receipt(app)
      .filter((x) => x.k !== 'doorways into the site')
      .map((x) => ({ k: capital(x.k), v: x.sub ? `${x.v}, ${x.sub}` : x.v })),
  ];

  const list = checklist(p.v);
  const build: FairRow[] = [
    { k: 'Releases', v: f(p.build.releases) },
    { k: 'Deploys today', v: f(p.build.deploysToday) },
    { k: 'Deploys a day on average', v: f(p.build.deploysPerDay, 1) },
    { k: 'Lines of code written', v: f(p.build.linesWritten) },
    { k: 'Ideas from Daydream that shipped', v: f(p.build.fromDaydream) },
  ];
  if (list.bench) build.push({ k: 'The builder', v: list.bench.text });

  const rest: FairRow[] = codaItems(p.v, p.now).map((c) => ({ k: c.name, v: c.line }));
  return { daydream, health, app: appRows, build, rest };
}

/** The whole notebook typed up in one list, page after page. */
export function fairRows(p: FairInput): FairRow[] {
  return Object.values(fairPages(p)).flat();
}

/* ------------------------------------------------------------------- words */

/** Each page's fixed words: the margin kicker, the heading and the lede. */
export const PAGES = {
  daydream: {
    kicker: 'daydream',
    head: 'It thinks while nobody’s watching',
    lede: 'When nobody’s asking it anything, the site picks an area of my life, asks itself one narrow question, looks things up and writes down anything worth my attention. Its own auditor crosses out what it can’t back up, and I mark the rest useful or not.',
    href: '/projects/engine-room/daydream',
    more: 'How it thinks',
  },
  health: {
    kicker: 'health',
    head: 'My body, on the record',
    lede: 'My watch and my phone report everything they count to the site, which keeps the record and draws it up on the health page. Out here it’s totals and bands only. It knows more about my sleep than I do.',
    href: '/health',
    more: 'The whole record',
  },
  app: {
    kicker: 'the app',
    head: 'It lives in my pocket',
    lede: 'The site has its own app for my iPhone and Apple Watch, built alongside it, so the same record turns up on my Lock Screen, my Home Screen and my wrist, and it’s where I answer Daydream.',
    href: '/projects/engine-room/app',
    more: 'How the app works',
  },
  build: {
    kicker: 'the builder',
    head: 'It rewrites itself, then ships',
    lede: 'Ideas I accept, mine or Daydream’s, go to a builder that writes the change, tests it and puts up a preview. Whatever passes the gates ships, and every release writes up its own notes. I mostly supervise.',
    href: '/projects/engine-room/build',
    more: 'How it builds',
  },
  rest: {
    kicker: 'and the rest',
    head: 'Also in this notebook',
    lede: 'A few more things the site gets up to, written smaller.',
    href: '/projects/engine-room',
    more: 'The engine room',
  },
} as const;

/** Every literal string the pages print, so the copy rules can be checked in one place. */
export function allCopy(): string[] {
  return Object.values(PAGES).flatMap((p) => [p.kicker, p.head, p.lede, p.more]);
}
