// chartkit.ts — a tiny, library-free helper kit for the bespoke-SVG charts in this route.
// The house style hand-rolls every chart; this module just removes the ~40 lines of
// scale + tick geometry that every new interactive chart was otherwise re-implementing.
// Pure functions only — no Svelte, no DOM. Self-contained.

/** A linear scale domain→range, with a few conveniences. */
export interface LinScale {
  (v: number): number;
  invert: (px: number) => number;
  domain: [number, number];
  range: [number, number];
}

/** Build a clamped-free linear scale. */
export function linScale(domain: [number, number], range: [number, number]): LinScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const dspan = d1 - d0 || 1;
  const fn = ((v: number) => r0 + ((v - d0) / dspan) * (r1 - r0)) as LinScale;
  fn.invert = (px: number) => d0 + ((px - r0) / (r1 - r0 || 1)) * dspan;
  fn.domain = domain;
  fn.range = range;
  return fn;
}

/** "Nice" round tick values spanning [lo, hi] with about `count` divisions. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!isFinite(lo) || !isFinite(hi) || lo === hi) return [lo];
  const raw = (hi - lo) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const ticks: number[] = [];
  const start = Math.ceil(lo / step) * step;
  for (let t = start; t <= hi + step * 1e-9; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

/** Min/max of a set of series, padded by `pad` fraction; optionally zero-anchored. */
export function extent(values: number[], pad = 0.08, zeroBased = false): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
  if (zeroBased) lo = Math.min(lo, 0);
  if (lo === hi) hi = lo + 1;
  const p = (hi - lo) * pad;
  return { lo: zeroBased ? lo : lo - p, hi: hi + p };
}

/** Build an SVG path "M..L.." from (x,y) point pairs, skipping non-finite y. */
export function polyline(xs: number[], ys: number[]): string {
  let d = '';
  for (let i = 0; i < xs.length; i++) {
    if (!isFinite(ys[i])) continue;
    d += `${d === '' ? 'M' : 'L'}${xs[i].toFixed(1)},${ys[i].toFixed(1)} `;
  }
  return d.trim();
}

/** Clamp helper (shared idiom). */
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Format a number with fixed dp, en-GB grouping. */
export function fmt(v: number, dp = 1): string {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Signed delta with an explicit + for positives (used in "this much" readouts). */
export function signed(v: number, dp = 1): string {
  if (!isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}
