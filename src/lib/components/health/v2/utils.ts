export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function ramp(t: number): string {
  t = clamp(t, 0, 1);
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [237, 228, 212]],
    [0.4, [232, 200, 158]],
    [0.65, [222, 142, 64]],
    [0.85, [196, 87, 10]],
    [1.0, [138, 58, 8]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const k = (t - t0) / (t1 - t0);
      const c = c0.map((v, j) => Math.round(lerp(v, c1[j], k)));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  return 'rgb(196,87,10)';
}

export function fmtAgo(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function dayLabel(iso: string): { dom: number; mon: string; dow: string } {
  const d = new Date(iso + 'T00:00:00Z');
  return {
    dom: d.getUTCDate(),
    mon: d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }).toUpperCase(),
    dow: d.toLocaleString('en', { weekday: 'short', timeZone: 'UTC' })[0].toUpperCase(),
  };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export type PulseRowKey = 'rec' | 'hrv' | 'rhr' | 'slept' | 'strain' | 'steps' | 'weight';

// Lower-is-better keys; everything else ranks max wins.
const MIN_DIRECTION: ReadonlySet<PulseRowKey> = new Set(['rhr']);

// Returns the index of the best day in `values` for this metric, or -1 if none.
// Skips entries where the raw value is <= 0 (no data). Strict comparison keeps
// the first occurrence on ties — fine, since ties are now on real values rather
// than clamp artefacts.
export function pulsePeakIndex(key: PulseRowKey, values: ReadonlyArray<number>): number {
  const minDir = MIN_DIRECTION.has(key);
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
