export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ────────────────────────────────────────────────────────────────────────────
   Pulse grid colour model
   ────────────────────────────────────────────────────────────────────────────
   The grid answers "how was I doing", not "what was big", so colour is
   DIVERGING about each row's own baseline:

     better than baseline  →  green
     at baseline           →  a near-cream neutral that still reads as a tile
     worse than baseline   →  red

   Which end is "better" comes from the row's declared direction, so no row has
   to pre-invert its own normaliser (the old RHR special case).

   RED AND GREEN ARE THE CLASSIC COLOURBLIND TRAP, and a symmetric ramp — deep
   red against deep green — is unreadable to roughly one man in twelve: measured
   here at ΔE 2.4 under deuteranopia, which is indistinguishable. So the two
   arms are deliberately ASYMMETRIC IN LIGHTNESS as well as hue. Bad days run
   dark and heavy, good days run light and open, and every step of the worse arm
   is darker than the matching step of the better arm.

   The poles are #8f2318 and #6aa63c, validated: ΔE 32.9 in normal vision and
   ΔE 22.3 under deuteranopia, both comfortably clear. Luminance is monotonic
   along each arm (worse 0.62 → 0.07, better 0.75 → 0.31), so the grid still
   reads as magnitude in greyscale, in print, and under forced colours.

   Colour is never the only encoding regardless: every cell carries an
   aria-label with its value and verdict, the tooltip states both, and the best
   day in each row is ringed.
   ──────────────────────────────────────────────────────────────────────────── */

type Rgb = [number, number, number];
type Stop = [number, Rgb];

/** Baseline neutral. Deliberately lighter than --surface-rail (the grid's
 *  gutter) so an at-baseline tile is still visibly a tile. */
const PULSE_NEUTRAL: Rgb = [230, 220, 203];

/** Magnitude 0→1 away from baseline on the BETTER side. Green, and lighter. */
const BETTER_STOPS: Stop[] = [
  [0.0, PULSE_NEUTRAL],
  // Slightly darker than the neutral, not lighter: green is heavily weighted in
  // luminance, and a first good step that came out BRIGHTER than baseline made a
  // barely-good day read as a blank cell.
  [0.3, [211, 223, 182]],
  [0.6, [189, 211, 150]],
  [0.82, [148, 194, 104]],
  [1.0, [106, 166, 60]], // #6aa63c
];

/** Magnitude 0→1 away from baseline on the WORSE side. Red, and darker. */
const WORSE_STOPS: Stop[] = [
  [0.0, PULSE_NEUTRAL],
  [0.3, [232, 201, 182]],
  [0.6, [208, 138, 106]],
  [0.82, [184, 74, 48]],
  [1.0, [143, 35, 24]], // #8f2318
];

/** Single-hue sequential ramp for rows with NO direction of good (weight).
 *  Warm sepia — deliberately neither pole, so it cannot be read as a verdict. */
const NEUTRAL_STOPS: Stop[] = [
  [0.0, [240, 233, 221]],
  [0.35, [206, 193, 172]],
  [0.7, [151, 133, 110]],
  [1.0, [74, 60, 44]],
];

function interpolate(stops: Stop[], t: number): string {
  // NaN paints the low end; ±Infinity clamps to the ends like any other number.
  const v = Number.isNaN(t) ? 0 : clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (v >= t0 && v <= t1) {
      const k = t1 === t0 ? 0 : (v - t0) / (t1 - t0);
      const c = c0.map((x, j) => Math.round(lerp(x, c1[j], k)));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  const last = stops[stops.length - 1][1];
  return `rgb(${last[0]}, ${last[1]}, ${last[2]})`;
}

/**
 * The diverging pulse ramp.
 *
 * `p` is a SIGNED position: -1 = as bad as this row gets, 0 = this row's own
 * baseline, +1 = as good as this row gets. NaN paints the baseline neutral;
 * ±Infinity clamps to a pole like any other out-of-range number.
 */
export function ramp(p: number): string {
  // NaN falls back to the baseline neutral; ±Infinity clamps to a pole.
  const v = Number.isNaN(p) ? 0 : clamp(p, -1, 1);
  return v >= 0 ? interpolate(BETTER_STOPS, v) : interpolate(WORSE_STOPS, -v);
}

/** Sequential ramp for a row with no direction of good. `t` is 0→1. */
export function neutralRamp(t: number): string {
  return interpolate(NEUTRAL_STOPS, t);
}

/**
 * A CSS gradient sampled from `ramp` itself, so the legend can never drift
 * from the cells. Left = worst, centre = baseline, right = best.
 */
export function rampGradient(steps = 17): string {
  const n = Math.max(2, Math.round(steps));
  const cs: string[] = [];
  for (let i = 0; i < n; i++) cs.push(ramp(-1 + (2 * i) / (n - 1)));
  return `linear-gradient(to right, ${cs.join(', ')})`;
}

/** Same trick for the neutral ramp: light (low) → dark (high). */
export function neutralGradient(steps = 9): string {
  const n = Math.max(2, Math.round(steps));
  const cs: string[] = [];
  for (let i = 0; i < n; i++) cs.push(neutralRamp(i / (n - 1)));
  return `linear-gradient(to right, ${cs.join(', ')})`;
}

/* ── Baseline + position ─────────────────────────────────────────────────── */

export type PulseBaseline = {
  /** Median over days that HAVE data. 0 when the row is empty. */
  median: number;
  /** Robust spread: 1.4826·MAD, falling back to IQR/1.349, then 5% of the
   *  median, then 1. Never 0 when `n > 0`. */
  spread: number;
  /** How many days had data. */
  n: number;
};

export type PulseExtent = { min: number; max: number; n: number };

function quantile(sorted: ReadonlyArray<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : lerp(sorted[lo], sorted[hi], pos - lo);
}

/** HealthDay carries NO nulls — 0 is the missing sentinel — so every summary
 *  here drops non-positive values rather than averaging a gap in as a zero. */
function present(values: ReadonlyArray<number>): number[] {
  return values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
}

/**
 * Median + robust spread over the window. Robust on purpose: a single 21-strain
 * day or one missed-sync outlier must not flatten the whole row into neutral,
 * which is exactly what a min/max normaliser does.
 */
export function pulseBaseline(values: ReadonlyArray<number>): PulseBaseline {
  const vals = present(values);
  const n = vals.length;
  if (n === 0) return { median: 0, spread: 0, n: 0 };

  const med = quantile(vals, 0.5);
  const devs = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = quantile(devs, 0.5) * 1.4826;
  const iqr = (quantile(vals, 0.75) - quantile(vals, 0.25)) / 1.349;

  let spread = mad;
  if (!(spread > 0)) spread = iqr;
  if (!(spread > 0)) spread = Math.abs(med) * 0.05;
  if (!(spread > 0)) spread = 1;

  return { median: med, spread, n };
}

/** Plain min/max over days that have data — for rows with no direction. */
export function pulseExtent(values: ReadonlyArray<number>): PulseExtent {
  const vals = present(values);
  if (!vals.length) return { min: 0, max: 0, n: 0 };
  return { min: vals[0], max: vals[vals.length - 1], n: vals.length };
}

export type PulseDirection = 'higher-is-better' | 'lower-is-better' | 'neutral';
/** A row that can diverge. `neutral` rows use `sequentialPosition` instead, and
 *  the type forbids passing one here rather than silently guessing a verdict. */
export type PulseDivergingDirection = Exclude<PulseDirection, 'neutral'>;

/** How many robust deviations from the median saturate a pole. */
export const PULSE_SATURATION_Z = 2;

/**
 * Signed, clamped position of `value` against the row's own baseline.
 *
 * Returns -1…+1, where the SIGN already encodes better/worse for this row's
 * direction (so `lower-is-better` rows need no inverted normaliser), or `null`
 * when there is nothing to place: `value <= 0` is the missing sentinel, and an
 * empty window has no baseline to place it against.
 */
export function divergingPosition(
  value: number,
  baseline: PulseBaseline,
  direction: PulseDivergingDirection,
): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (baseline.n === 0 || !(baseline.spread > 0)) return null;
  const z = (value - baseline.median) / baseline.spread;
  const signed = direction === 'lower-is-better' ? -z : z;
  const p = clamp(signed / PULSE_SATURATION_Z, -1, 1);
  // Negating a zero z gives -0, which is a real value here and a nasty one to
  // assert against. A day on the median is 0, whichever way the row points.
  return p === 0 ? 0 : p;
}

/**
 * Position of `value` in 0…1 across the window's own min–max. `null` for the
 * missing sentinel or an empty window; 0.5 when every day shares one value.
 */
export function sequentialPosition(value: number, extent: PulseExtent): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (extent.n === 0) return null;
  const span = extent.max - extent.min;
  if (!(span > 0)) return 0.5;
  return clamp((value - extent.min) / span, 0, 1);
}

/**
 * Plain-words reading of a position, so colour is never the only encoding.
 *
 * Deliberately says BETTER/WORSE and not above/below: on a lower-is-better row
 * a good day is a low number, and "above baseline" would then read backwards to
 * anyone using the label instead of the colour.
 */
export function pulseTone(position: number | null, direction: PulseDirection): string {
  if (position === null) return 'no data';
  if (direction === 'neutral') {
    // 0…1 across the window's own range. A reading, never a verdict.
    if (position >= 0.75) return 'high in range';
    if (position <= 0.25) return 'low in range';
    return 'mid range';
  }
  if (Math.abs(position) < 0.15) return 'at baseline';
  if (position >= 0.6) return 'much better than baseline';
  if (position > 0) return 'better than baseline';
  if (position <= -0.6) return 'much worse than baseline';
  return 'worse than baseline';
}

/* ── Misc ────────────────────────────────────────────────────────────────── */

export function fmtAgo(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function dayLabel(iso: string): { dom: number; mon: string; dow: string; dowIndex: number } {
  const d = new Date(iso + 'T00:00:00Z');
  return {
    dom: d.getUTCDate(),
    mon: d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }).toUpperCase(),
    dow: d.toLocaleString('en', { weekday: 'short', timeZone: 'UTC' })[0].toUpperCase(),
    // 0 = Sunday. The ISO string is already a LOCAL day from the server, so
    // parsing it at UTC midnight reads back the same calendar day.
    dowIndex: d.getUTCDay(),
  };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export type PulseRowKey = 'rec' | 'hrv' | 'rhr' | 'slept' | 'strain' | 'steps' | 'weight';

/**
 * Direction of good, declared once. `pulsePeakIndex` and the cell colouring
 * both read it, so a row cannot rank one way and colour the other.
 *
 * `weight` is deliberately `neutral`: there is no direction of good, so it gets
 * a sequential ramp and no "best day" ring.
 */
export const PULSE_DIRECTION: Record<PulseRowKey, PulseDirection> = {
  rec: 'higher-is-better',
  hrv: 'higher-is-better',
  rhr: 'lower-is-better',
  slept: 'higher-is-better',
  strain: 'higher-is-better',
  steps: 'higher-is-better',
  weight: 'neutral',
};

// Returns the index of the best day in `values` for this metric, or -1 if none.
// Skips entries where the raw value is <= 0 (no data). Strict comparison keeps
// the first occurrence on ties — fine, since ties are now on real values rather
// than clamp artefacts.
export function pulsePeakIndex(key: PulseRowKey, values: ReadonlyArray<number>): number {
  const minDir = PULSE_DIRECTION[key] === 'lower-is-better';
  let best = minDir ? Infinity : -Infinity;
  let idx = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v <= 0) continue;
    if (minDir ? v < best : v > best) {
      best = v;
      idx = i;
    }
  }
  return idx;
}
