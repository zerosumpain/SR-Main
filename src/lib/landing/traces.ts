// traces.ts — the waveforms drawn in the landing hero: the heartbeat line that
// runs under the title, and the small exact charts inside its footnotes.
//
// Pure and deterministic: the same inputs give the same path on the server and
// in the browser, so hydration never redraws. The footnote charts live in a
// fixed 1000×60 box, drawn with preserveAspectRatio="none" and non-scaling
// strokes, so their geometry never needs to know the rendered width. The hero's
// line is the exception: it is drawn in real pixels (see heartLine), because a
// sweep that travels along it has to cross one beat per real heartbeat.

export const TRACE_W = 1000;
export const TRACE_H = 60;
const BASE = 40;

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The rates the hero can draw. Wide enough for every reading the watch has
 * sent (36–189 bpm on record), so the line, the sweep and the copy that says
 * "keeps time at N bpm" agree; only an implausible reading is drawn at the
 * nearest end, and the hero then stops claiming the rate is exact.
 */
export const BPM_MIN = 30;
export const BPM_MAX = 200;
export const clampBpm = (bpm: number) => clamp(bpm, BPM_MIN, BPM_MAX);

/**
 * A PQRST complex per beat. The box is a six-second strip, so beats sit
 * 60/bpm seconds apart at the exact rate read: 60 bpm draws six, 72 draws a
 * seventh that starts at 5.0s. A complex that would run off the right edge
 * is left out, as a monitor strip cut mid-beat would show it.
 */
export function ecgTrace(bpm: number | null): string {
  const rate = clampBpm(bpm ?? 60);
  const span = (TRACE_W * 10) / rate; // 6 s strip → 1000 units; one beat = 60/rate s
  const k = Math.min(1, span / 125); // the complex was drawn for a 125-wide beat
  let d = `M0,${BASE}`;
  for (let o = 0; o + 104 * k <= TRACE_W; o += span) {
    const x = (n: number) => r1(o + n * k);
    d += ` L${x(30)},${BASE} Q${x(36)},${BASE - 6} ${x(42)},${BASE} L${x(52)},${BASE} L${x(55)},${BASE + 5}`;
    d += ` L${x(60)},6 L${x(65)},54 L${x(69)},${BASE} L${x(84)},${BASE} Q${x(94)},${BASE - 10} ${x(104)},${BASE}`;
  }
  return `${d} L${TRACE_W},${BASE}`;
}

/** Daily spikes from real counts, newest on the right, scaled to the busiest day in view. */
export function spikeTrace(counts: number[], window = 40): string {
  const floor = 50;
  const days = counts.slice(-window);
  if (days.length === 0) return `M0,${floor} L${TRACE_W},${floor}`;
  const peak = Math.max(1, ...days);
  const gap = TRACE_W / days.length;
  let d = `M0,${floor}`;
  days.forEach((c, i) => {
    const x = r1(i * gap + gap / 2);
    const h = c > 0 ? 4 + (c / peak) * 42 : 0;
    d += h > 0 ? ` L${x - 2},${floor} L${x},${r1(floor - h)} L${x + 2},${floor}` : '';
  });
  return `${d} L${TRACE_W},${floor}`;
}

/**
 * Today's steps as bars, one per quarter-hour: x = 0 is midnight, x = 1000 is
 * 23:59. Bars after `nowBin` are the future and draw nothing; the baseline
 * still runs the whole width so the strip reads as a full day.
 */
export function stepsTrace(bins: number[], nowBin: number): string {
  const floor = 54;
  const n = bins.length || 96;
  const peak = Math.max(1, ...bins);
  const w = TRACE_W / n;
  let d = `M0,${floor} L${TRACE_W},${floor}`;
  bins.forEach((v, i) => {
    if (i > nowBin || v <= 0) return;
    const x = r1(i * w + w / 2);
    d += ` M${x},${floor} L${x},${r1(floor - 3 - (v / peak) * 45)}`;
  });
  return d;
}

/**
 * The ruler under the steps bars: a tick on every hour, taller every six, so
 * the strip reads as a day laid out like a tape measure.
 */
export function rulerTicks(): string {
  let d = '';
  for (let h = 0; h <= 24; h++) {
    const x = r1((h / 24) * TRACE_W);
    d += `${d ? ' ' : ''}M${x},${TRACE_H} L${x},${TRACE_H - (h % 6 === 0 ? 6 : 3)}`;
  }
  return d;
}

/**
 * Where "now" falls on the ruler, in the same 1000-wide box: the far edge of
 * the quarter-hour in progress. Everything to its right is still pending.
 */
export function rulerNow(nowBin: number, bins = 96): number {
  return r1((clamp(nowBin, 0, bins - 1) + 1) * (TRACE_W / bins));
}

/**
 * The paper speed of the hero's heartbeat line. Fixed, as a monitor's is, so
 * the spacing of the beats IS the rate: a slower heart draws them further apart
 * even when nothing moves (reduced motion, "hold still", print).
 */
export const HEART_PX_PER_SECOND = 170;

export interface HeartLine {
  /** The path, in pixels: `width` across, `height` down. */
  d: string;
  /** Whole beats drawn; 0 for the flat line. */
  beats: number;
  /**
   * How far through each beat the R wave peaks, measured ALONG the line as a
   * share of one beat's length. A sweep that travels the line at a constant
   * rate (a stroke-dashoffset animation on pathLength=1) reaches the peak at
   * exactly this phase of the beat, so anything else that pulses with it can
   * be delayed by the same share of a beat and land on the spike.
   */
  peak: number;
}

/**
 * The hero's line: one PQRST complex per beat across `width` pixels at the
 * exact rate read, or a flat line when there is no fresh reading.
 *
 * The strip is a whole number of beats long, and every beat is the same shape,
 * so every beat is the same length along the path. A sweep that crosses the
 * whole path in `beats` heartbeats therefore crosses one complex per beat,
 * exactly, with no clock of its own.
 */
export function heartLine(bpm: number | null, width: number, height: number): HeartLine {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(24, Math.round(height));
  const base = r1(h * 0.66);
  if (bpm == null || !(bpm > 0)) return { d: `M0,${base} L${w},${base}`, beats: 0, peak: 0 };

  const beatSec = 60 / clampBpm(bpm);
  const seconds = clamp(w / HEART_PX_PER_SECOND, 3, 14);
  const beats = Math.max(1, Math.round(seconds / beatSec));
  const span = w / beats;
  // The complex lasts about 0.75s; a heart faster than that squeezes it.
  const pxs = (span / beatSec) * Math.min(1, beatSec / 0.85);

  // One complex as [command, time from the beat's start (s), y]. Q takes a
  // control point then an end point; L takes one point.
  const top = r1(h * 0.06);
  const dip = r1(h * 0.94);
  const shape: Array<['L', number, number] | ['Q', number, number, number, number]> = [
    ['L', 0.12, base],
    ['Q', 0.17, r1(base - h * 0.12), 0.22, base], // P
    ['L', 0.3, base],
    ['L', 0.33, r1(base + h * 0.07)], // Q
    ['L', 0.37, top], // R
    ['L', 0.41, dip], // S
    ['L', 0.44, base],
    ['L', 0.54, base],
    ['Q', 0.64, r1(base - h * 0.2), 0.74, base], // T
  ];

  let d = `M0,${base}`;
  for (let i = 0; i < beats; i++) {
    const x = (t: number) => r1(i * span + t * pxs);
    for (const s of shape) d += s[0] === 'L' ? ` L${x(s[1])},${s[2]}` : ` Q${x(s[1])},${s[2]} ${x(s[3])},${s[4]}`;
  }
  d += ` L${w},${base}`;

  // Arc length of one beat up to its R wave, over the whole beat's length.
  let len = 0;
  let toPeak = 0;
  let at: [number, number] = [0, base];
  const step = (p: [number, number]) => {
    len += Math.hypot(p[0] - at[0], p[1] - at[1]);
    at = p;
  };
  for (const s of shape) {
    if (s[0] === 'L') step([s[1] * pxs, s[2]]);
    else {
      const [x0, y0] = at;
      for (let j = 1; j <= 12; j++) {
        const u = j / 12;
        const q = (a: number, b: number, c: number) => (1 - u) ** 2 * a + 2 * (1 - u) * u * b + u ** 2 * c;
        step([q(x0, s[1] * pxs, s[3] * pxs), q(y0, s[2], s[4])]);
      }
    }
    if (s[0] === 'L' && s[2] === top) toPeak = len;
  }
  step([span, base]);
  return { d, beats, peak: Math.round((toPeak / len) * 1000) / 1000 };
}
