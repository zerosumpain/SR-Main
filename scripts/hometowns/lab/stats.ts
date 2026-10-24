// The Lab's statistics (spec §11.3): medians and quantiles, bootstrap
// confidence intervals (seeded, so a report is reproducible), the Gini
// coefficient, and the small amount of signal processing G10 needs. This is
// Node-side code, not engine code: it may use Math freely.

/** A seeded uniform generator (mulberry32) for resampling: reports are reproducible run to run. */
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

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Linear-interpolated quantile; Infinity entries sort last (a milestone never reached). */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi || !Number.isFinite(s[hi]) || !Number.isFinite(s[lo])) return s[Math.round(pos)];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (xs: readonly number[]): number => quantile(xs, 0.5);

export interface CI {
  est: number;
  lo: number;
  hi: number;
  n: number;
}

/** Percentile bootstrap 95% CI of `stat` over `xs` (B resamples, seeded). */
export function bootstrap(xs: readonly number[], stat: (s: number[]) => number, B = 1000, seed = 1): CI {
  const est = stat([...xs]);
  if (xs.length < 2) return { est, lo: est, hi: est, n: xs.length };
  const r = seeded(seed);
  const out: number[] = [];
  const buf = new Array<number>(xs.length);
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < xs.length; i++) buf[i] = xs[Math.floor(r() * xs.length)];
    out.push(stat(buf));
  }
  return { est, lo: quantile(out, 0.025), hi: quantile(out, 0.975), n: xs.length };
}

/** Bootstrap CI of a ratio of means, mean(a)/mean(b), resampling each group independently (unpaired). */
export function ratioCI(a: readonly number[], b: readonly number[], B = 1000, seed = 1): CI {
  const est = mean(a) / mean(b);
  if (a.length < 2 || b.length < 2) return { est, lo: est, hi: est, n: Math.min(a.length, b.length) };
  const r = seeded(seed);
  const out: number[] = [];
  for (let k = 0; k < B; k++) {
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < a.length; i++) sa += a[Math.floor(r() * a.length)];
    for (let i = 0; i < b.length; i++) sb += b[Math.floor(r() * b.length)];
    out.push(sa / a.length / (sb / b.length));
  }
  return { est, lo: quantile(out, 0.025), hi: quantile(out, 0.975), n: Math.min(a.length, b.length) };
}

/** Paired bootstrap CI of the mean difference (b − a) over pairs (A/B on the same seeds). */
export function pairedCI(a: readonly number[], b: readonly number[], B = 1000, seed = 1): CI {
  const d = a.map((x, i) => b[i] - x);
  return bootstrap(d, mean, B, seed);
}

/** Share of `xs` for which `ok` holds, with a bootstrap CI. */
export function shareCI(flags: readonly boolean[], B = 1000, seed = 1): CI {
  return bootstrap(flags.map((f) => (f ? 1 : 0)), mean, B, seed);
}

/** Gini coefficient of non-negative sizes (0 equal, → 1 one holds all). */
export function gini(xs: readonly number[]): number {
  const s = [...xs].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = s.length;
  if (n < 2) return 0;
  let cum = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    cum += (i + 1) * s[i];
    total += s[i];
  }
  if (total <= 0) return 0;
  return (2 * cum) / (n * total) - (n + 1) / n;
}

/** Pearson correlation (NaN for fewer than 3 points or no variance). */
export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
}

/** Removes the least-squares line (so a growing town's trend is not read as a cycle). */
export function detrend(xs: readonly number[]): number[] {
  const n = xs.length;
  if (n < 3) return xs.map(() => 0);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += xs[i];
    sxx += i * i;
    sxy += i * xs[i];
  }
  const slope = (n * sxy - sx * sy) / Math.max(1e-12, n * sxx - sx * sx);
  const icpt = (sy - slope * sx) / n;
  return xs.map((y, i) => y - (icpt + slope * i));
}

/** Periodogram |X(k)|² for k = 1 … n/2 of a (detrended) series. */
export function periodogram(xs: readonly number[]): number[] {
  const n = xs.length;
  const out: number[] = [];
  for (let k = 1; k <= Math.floor(n / 2); k++) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * k) / n;
    for (let t = 0; t < n; t++) {
      re += xs[t] * Math.cos(w * t);
      im -= xs[t] * Math.sin(w * t);
    }
    out.push(re * re + im * im);
  }
  return out;
}

/** The dominant cycle: its period (in samples) and its share of the spectrum's peak over the mean power. */
export function dominantCycle(xs: readonly number[]): { period: number; peakRatio: number } {
  const p = periodogram(detrend(xs));
  if (p.length === 0) return { period: Infinity, peakRatio: 0 };
  let k = 0;
  for (let i = 1; i < p.length; i++) if (p[i] > p[k]) k = i;
  const m = mean(p);
  return { period: xs.length / (k + 1), peakRatio: m > 0 ? p[k] / m : 0 };
}

/** Sign changes of a series with a hysteresis band: a value inside ±band keeps the previous sign. */
export function signChanges(xs: readonly number[], band: number): number[] {
  // Returns the indices at which the sign flipped, so callers can count flips in any window.
  const flips: number[] = [];
  let sign = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const s = x > band ? 1 : x < -band ? -1 : 0;
    if (s === 0) continue;
    if (sign !== 0 && s !== sign) flips.push(i);
    sign = s;
  }
  return flips;
}

/** The most flips inside any window of `width` samples. */
export function maxInWindow(indices: readonly number[], width: number): number {
  let best = 0;
  let j = 0;
  for (let i = 0; i < indices.length; i++) {
    while (indices[i] - indices[j] >= width) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

/** Longest run of consecutive samples for which `test` holds. */
export function longestRun(xs: readonly number[], test: (x: number) => boolean): number {
  let best = 0;
  let run = 0;
  for (const x of xs) {
    run = test(x) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

export const round = (x: number, d = 3): number => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

/** The largest value (−Infinity for none), without spreading a long array onto the call stack. */
export function maxOf(xs: readonly number[]): number {
  let m = -Infinity;
  for (const x of xs) if (x > m) m = x;
  return m;
}
