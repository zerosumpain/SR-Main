// src/lib/daydream/stats/tests.ts
//
// The statistical instruments, and the thing that stops them lying.
//
// The lying is the point of this file. A feature store with m metrics offers
// m(m-1)/2 distinct pairs — SWEEP_METRICS in sweep.ts is the live list, and at
// twenty-odd metrics that is a couple of hundred pairs; testing all of them at
// p < 0.05 produces about one "significant" result per twenty pairs by chance
// alone, on data with no structure whatsoever.
// A model handed that list will write fourteen confident sentences about
// someone's life, every one of them false, and they will read exactly like the
// true ones. There is no multiple-comparisons control anywhere in this codebase
// today, and the existing correlations service — the only prior art — buckets on
// |r| and n with no p-value at all.
//
// So every test here returns a p-value, every sweep passes through
// `benjaminiHochberg`, and nothing downstream is allowed to quote a result that
// has not been corrected. The correction is not decoration: at hundreds of
// tests it is the difference between a finding and a coin toss.
//
// PURE. No database, no clock, no imports.

export interface Series {
  key: string;
  /** Aligned with `other` by index; callers pair them before calling. */
  values: number[];
}

export interface TestResult {
  /** Pearson product-moment correlation. */
  r: number;
  /** Two-tailed p-value for r under the null of no association. */
  p: number;
  /** Pairs actually used — after dropping any day either side was missing. */
  n: number;
}

/** Below this, a correlation coefficient is arithmetic rather than evidence. */
export const MIN_PAIRS = 14;

/**
 * Pearson's r.
 *
 * Returns 0 for a degenerate input (fewer than two points, or either series
 * constant) rather than NaN — a constant series has no correlation to measure,
 * and NaN propagating into a ranking is how a nonsense row reaches the top.
 */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/** Ranks, averaging ties — the part of Spearman that is easy to get wrong. */
export function rankOf(values: number[]): number[] {
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    // Average rank for the whole tied block, 1-based.
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman's rho — Pearson over ranks.
 *
 * Offered alongside Pearson because almost nothing here is linear or normally
 * distributed: sleep against strain bends, step counts are heavily skewed by
 * rest days, and one holiday will drag a Pearson r on its own. Rank correlation
 * is the honest default for this data; Pearson is kept for the cases where the
 * relationship really is linear and the effect size matters.
 */
export function spearman(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  return pearson(rankOf(xs.slice(0, n)), rankOf(ys.slice(0, n)));
}

// ── p-values ─────────────────────────────────────────────────────────────────

/** Continued-fraction incomplete beta, for the t distribution below. */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function gammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularised incomplete beta I_x(a,b). */
export function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (bt * betacf(a, b, x)) / a
    : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/**
 * Two-tailed p for a correlation coefficient at n pairs.
 *
 * Via the t transform, t = r * sqrt((n-2) / (1-r^2)), which is exact under
 * bivariate normality and good enough under the rank transform. Returns 1 —
 * "no evidence" — for degenerate inputs rather than throwing, because the
 * caller is sweeping hundreds of pairs and one degenerate pair must not take
 * the whole sweep down.
 */
export function pValueForR(r: number, n: number): number {
  if (!Number.isFinite(r) || n < 3) return 1;
  const rr = Math.min(0.999999999999, Math.abs(r));
  const df = n - 2;
  const t = rr * Math.sqrt(df / (1 - rr * rr));
  const p = incompleteBeta(df / 2, 0.5, df / (df + t * t));
  return Math.min(1, Math.max(0, p));
}

/** Correlate two aligned series, dropping any index where either is missing. */
export function correlate(
  xs: Array<number | null>,
  ys: Array<number | null>,
  method: 'pearson' | 'spearman' = 'spearman',
): TestResult {
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    // Pairwise deletion. A day either side could not see is not a data point,
    // and imputing it with a mean is how an outage becomes a relationship.
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    a.push(x);
    b.push(y);
  }
  const n = a.length;
  if (n < MIN_PAIRS) return { r: 0, p: 1, n };
  const r = method === 'pearson' ? pearson(a, b) : spearman(a, b);
  return { r, p: pValueForR(r, n), n };
}

// ── multiple comparisons ─────────────────────────────────────────────────────

export interface Corrected<T> {
  item: T;
  p: number;
  /** Benjamini-Hochberg adjusted p, monotone in the raw ordering. */
  qValue: number;
  /** Survives at the requested false-discovery rate. */
  significant: boolean;
}

/** The false-discovery rate the sweep is allowed to run at. */
export const DEFAULT_FDR = 0.1;

/**
 * Benjamini-Hochberg step-up.
 *
 * Chosen over Bonferroni deliberately. Bonferroni controls the chance of ANY
 * false positive, which at 276 tests means a threshold of 0.00018 and the
 * discovery of nothing whatever — the correct answer to "is this definitely
 * true" and the wrong tool for "what is worth a look". BH controls the expected
 * PROPORTION of false positives among the things reported, so at q = 0.1 roughly
 * one in ten survivors is noise. That is an honest trade for a feature whose
 * output is a proposition to be checked, not a claim to be acted on — and the
 * q-value travels with every finding so the number can be shown rather than
 * implied.
 *
 * The enforced monotonicity (the running minimum, walking down) is the step
 * people leave out; without it a less significant test can end up with a
 * smaller adjusted p than a more significant one.
 */
export function benjaminiHochberg<T>(
  items: Array<{ item: T; p: number }>,
  fdr = DEFAULT_FDR,
): Array<Corrected<T>> {
  const m = items.length;
  if (m === 0) return [];

  const ordered = items
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => a.p - b.p);

  const q = new Array<number>(m);
  let running = 1;
  for (let k = m - 1; k >= 0; k--) {
    const raw = (ordered[k].p * m) / (k + 1);
    running = Math.min(running, raw);
    q[k] = Math.min(1, running);
  }

  const out = new Array<Corrected<T>>(m);
  for (let k = 0; k < m; k++) {
    out[ordered[k].i] = {
      item: ordered[k].item,
      p: ordered[k].p,
      qValue: q[k],
      significant: q[k] <= fdr,
    };
  }
  return out;
}
