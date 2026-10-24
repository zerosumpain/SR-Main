// Hometowns' deterministic maths. The engine must give bit-identical answers
// in Node (V8) and on the phone (JavaScriptCore), and the two engines do not
// promise the same last bit for Math.exp, Math.log, Math.sin or Math.tanh.
// They do promise it for + − × ÷ and Math.sqrt (IEEE-754 correctly rounded),
// so every transcendental function here is built from those alone: range
// reduction by exact powers of two, then a fixed polynomial. The two hot
// shapes the economy calls thousands of times a month, T (tanh) and σ
// (logistic), come from tables built once at load by the same polynomials and
// read back with cubic Hermite interpolation. Error bounds are pinned by
// fx.test.ts over the documented ranges.
//
// Nothing here may call Math.exp, Math.log, Math.pow, Math.sin, Math.cos,
// Math.tanh, Math.atan, Math.cbrt or Math.hypot: banned.test.ts greps for them.

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
export const LN2 = 0.6931471805599453;
export const SQRT2 = 1.4142135623730951;

// Cody–Waite split of ln 2 and 2π, so k·C is subtracted in two exact-ish
// steps and range reduction keeps full precision for large arguments.
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const TWO_PI_HI = 6.283185307179586;
const TWO_PI_LO = 2.4492935982947064e-16;

/** 2^k for an integer k, by exact repeated squaring (never subnormal in our ranges). */
export function pow2i(k: number): number {
  let n = k < 0 ? -k : k;
  let base = 2;
  let out = 1;
  while (n > 0) {
    if (n & 1) out *= base;
    base *= base;
    n >>= 1;
  }
  return k < 0 ? 1 / out : out;
}

/** e^x. Relative error < 2e-15 for |x| ≤ 700; clamps outside. */
export function expFx(x: number): number {
  if (x !== x) return x;
  if (x > 700) x = 700;
  if (x < -700) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2_HI - k * LN2_LO; // |r| ≤ 0.347
  // Taylor to degree 14 in Horner form: the tail is below 1e-17 on |r| ≤ 0.35.
  let p = 1 / 87178291200;
  p = p * r + 1 / 6227020800;
  p = p * r + 1 / 479001600;
  p = p * r + 1 / 39916800;
  p = p * r + 1 / 3628800;
  p = p * r + 1 / 362880;
  p = p * r + 1 / 40320;
  p = p * r + 1 / 5040;
  p = p * r + 1 / 720;
  p = p * r + 1 / 120;
  p = p * r + 1 / 24;
  p = p * r + 1 / 6;
  p = p * r + 0.5;
  p = p * r + 1;
  p = p * r + 1;
  return p * pow2i(k);
}

/** ln x for x > 0 (−Infinity at 0, NaN below). Relative error < 1e-15 away from x = 1, absolute < 1e-16 near it. */
export function lnFx(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return Infinity;
  let e = 0;
  // Exact rescaling by powers of two into [1, 2).
  while (x >= 4294967296) {
    x /= 4294967296;
    e += 32;
  }
  while (x < 2.3283064365386963e-10) {
    x *= 4294967296;
    e -= 32;
  }
  while (x >= 2) {
    x /= 2;
    e += 1;
  }
  while (x < 1) {
    x *= 2;
    e -= 1;
  }
  if (x > SQRT2) {
    x /= 2;
    e += 1;
  }
  // ln m = 2·atanh(s), s = (m − 1)/(m + 1), |s| ≤ 0.1716: odd series to s^23.
  const s = (x - 1) / (x + 1);
  const s2 = s * s;
  let p = 1 / 23;
  p = p * s2 + 1 / 21;
  p = p * s2 + 1 / 19;
  p = p * s2 + 1 / 17;
  p = p * s2 + 1 / 15;
  p = p * s2 + 1 / 13;
  p = p * s2 + 1 / 11;
  p = p * s2 + 1 / 9;
  p = p * s2 + 1 / 7;
  p = p * s2 + 1 / 5;
  p = p * s2 + 1 / 3;
  p = p * s2 + 1;
  return e * LN2_HI + (e * LN2_LO + 2 * s * p);
}

/** x^y for x > 0 (and 0^y = 0 for y > 0). Integer y uses exact repeated multiplication. */
export function powFx(x: number, y: number): number {
  if (y === 0) return 1;
  if (Number.isInteger(y) && y > 0 && y <= 64) {
    let out = 1;
    let base = x;
    let n = y;
    while (n > 0) {
      if (n & 1) out *= base;
      base *= base;
      n >>= 1;
    }
    return out;
  }
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) return NaN;
  return expFx(y * lnFx(x));
}

/** sin x. Absolute error < 1e-15 for |x| ≤ 1e6. */
export function sinFx(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const n = Math.round(x / TWO_PI);
  let r = x - n * TWO_PI_HI - n * TWO_PI_LO; // r in [−π, π]
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  // Odd Taylor series to r^19 on |r| ≤ π/2: tail below 1e-17.
  const r2 = r * r;
  let p = -1 / 121645100408832000;
  p = p * r2 + 1 / 355687428096000;
  p = p * r2 - 1 / 1307674368000;
  p = p * r2 + 1 / 6227020800;
  p = p * r2 - 1 / 39916800;
  p = p * r2 + 1 / 362880;
  p = p * r2 - 1 / 5040;
  p = p * r2 + 1 / 120;
  p = p * r2 - 1 / 6;
  p = p * r2 + 1;
  return r * p;
}

/** cos x, through sin. */
export function cosFx(x: number): number {
  return sinFx(x + HALF_PI);
}

/** tanh x computed directly (the tables below are built from it). Relative error < 1e-13. */
export function tanhFx(x: number): number {
  if (x !== x) return x;
  const a = x < 0 ? -x : x;
  let t: number;
  if (a < 0.125) {
    // Odd series: the subtraction e − 1 would lose digits this close to 0.
    const a2 = a * a;
    t = a * (1 + a2 * (-1 / 3 + a2 * (2 / 15 + a2 * (-17 / 315 + a2 * (62 / 2835 + a2 * (-1382 / 155925))))));
  } else if (a > 20) {
    t = 1;
  } else {
    const e = expFx(2 * a);
    t = (e - 1) / (e + 1);
  }
  return x < 0 ? -t : t;
}

/** The logistic 1/(1 + e^−x), computed directly. */
export function logisticFx(x: number): number {
  if (x >= 0) return 1 / (1 + expFx(-x));
  const e = expFx(x);
  return e / (1 + e);
}

// ---- Tables --------------------------------------------------------------------
//
// Cubic Hermite interpolation needs only values and slopes at the knots, and
// both shapes have slopes that are functions of their values (tanh' = 1 − t²,
// σ' = σ(1 − σ)), so a table of values is all we store. The interpolation
// error is about h⁴/384·max|f''''|: below 3e-10 absolute for T (h = 1/128)
// and 1e-6 relative for σ (h = 1/32), as fx.test.ts measures.

const T_STEP = 128; // knots per unit
const T_MAX = 12; // tanh(12) = 1 − 8e-11: beyond it T returns ±1 within every bound below
const T_TABLE = buildTable(T_MAX * T_STEP, (i) => tanhFx(i / T_STEP));

const S_STEP = 32;
const S_MAX = 24; // σ(−24) ≈ 3.8e-11: beyond it σ falls back to the direct form
const S_TABLE = buildTable(2 * S_MAX * S_STEP, (i) => logisticFx(i / S_STEP - S_MAX));

function buildTable(n: number, f: (i: number) => number): Float64Array {
  const out = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) out[i] = f(i);
  return out;
}

function hermite(y0: number, y1: number, d0: number, d1: number, u: number, h: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * d0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * d1;
}

/**
 * T(x): table-driven tanh. Relative error < 1e-6 everywhere (and < 1e-9
 * absolute for |x| ≤ 10). This is the `T` of the spec's notation.
 */
export function T(x: number): number {
  if (x !== x) return x;
  const a = x < 0 ? -x : x;
  if (a >= T_MAX) return x < 0 ? -1 : 1;
  if (a < 0.125) return tanhFx(x); // the series is cheaper and exact in relative terms near 0
  const p = a * T_STEP;
  const i = Math.floor(p);
  const u = p - i;
  const y0 = T_TABLE[i];
  const y1 = T_TABLE[i + 1];
  const t = hermite(y0, y1, 1 - y0 * y0, 1 - y1 * y1, u, 1 / T_STEP);
  return x < 0 ? -t : t;
}

/** σ(x): table-driven logistic, relative error < 1e-6 for all x. */
export function sigma(x: number): number {
  if (x !== x) return x;
  if (x <= -S_MAX || x >= S_MAX) return logisticFx(x);
  const p = (x + S_MAX) * S_STEP;
  const i = Math.floor(p);
  const u = p - i;
  const y0 = S_TABLE[i];
  const y1 = S_TABLE[i + 1];
  return hermite(y0, y1, y0 * (1 - y0), y1 * (1 - y1), u, 1 / S_STEP);
}

/** sat(x) = x/(1 + x), the saturating curve. */
export function sat(x: number): number {
  return x / (1 + x);
}

/** M(r; a, b) = 1 + a·T(b·(r − 1)): neutral at r = 1, bounded in [1 − a, 1 + a]. */
export function M(r: number, a: number, b: number): number {
  return 1 + a * T(b * (r - 1));
}

/** S(X̄, X, τ): first-order smoothing, one step of X̄ += (X − X̄)/τ. */
export function smooth(prev: number, target: number, tau: number): number {
  return prev + (target - prev) / (tau < 1 ? 1 : tau);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * The standard normal quantile Φ⁻¹(u) for u in (0, 1), by Acklam's rational
 * approximation (relative error < 1.2e-9), using lnFx and Math.sqrt only.
 */
export function invNormal(u: number): number {
  if (!(u > 0 && u < 1)) return u <= 0 ? -Infinity : Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (u < lo) {
    const q = Math.sqrt(-2 * lnFx(u));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (u > 1 - lo) {
    const q = Math.sqrt(-2 * lnFx(1 - u));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = u - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
