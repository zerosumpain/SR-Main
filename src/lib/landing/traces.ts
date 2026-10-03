// traces.ts — the waveforms drawn in the landing page's capability monitor.
//
// Each trace is an SVG path in a fixed 1000×60 box, drawn with
// preserveAspectRatio="none" and non-scaling strokes, so the geometry here never
// needs to know the rendered width. Pure and deterministic: the same inputs give
// the same path on the server and in the browser, so hydration never redraws.
//
// The shapes are signatures, not plots. Each reads as what its capability does
// (a heartbeat, a day on foot, a think tick on a schedule, deploy spikes), and
// each is scaled by the one live number that capability has, so an active
// system visibly looks different.

export const TRACE_W = 1000;
export const TRACE_H = 60;
const BASE = 40;

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A PQRST complex per beat. The box is a six-second strip, so beats sit
 * 60/bpm seconds apart at the exact rate read: 60 bpm draws six, 72 draws a
 * seventh that starts at 5.0s. A complex that would run off the right edge
 * is left out, as a monitor strip cut mid-beat would show it.
 */
export function ecgTrace(bpm: number | null): string {
  const rate = Math.min(160, Math.max(40, bpm ?? 60));
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

/** Square pulses on a fixed period: a scheduled job. `lit` raises them. */
export function tickTrace(count: number, width: number, lit: boolean): string {
  const n = Math.max(1, Math.round(count));
  const gap = TRACE_W / n;
  const h = lit ? 30 : 18;
  const floor = 48;
  let d = `M0,${floor}`;
  for (let i = 0; i < n; i++) {
    const x = r1(i * gap + gap / 2 - width / 2);
    d += ` L${x},${floor} L${x},${floor - h} L${r1(x + width)},${floor - h} L${r1(x + width)},${floor}`;
  }
  return `${d} L${TRACE_W},${floor}`;
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

/** Hour marks for the steps strip: 06:00, 12:00 and 18:00. */
export function hourMarks(): string {
  return [6, 12, 18].map((h) => `M${r1((h / 24) * TRACE_W)},56 L${r1((h / 24) * TRACE_W)},60`).join(' ');
}
