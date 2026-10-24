// Integer accounting (spec §4.5, A25). People and pounds are whole numbers.
// Every named flow is computed as a double and then rounded with a carry: the
// fractional remainder is kept (as an integer number of millionths) under the
// flow's own key, so 0.3 births a month still add up to a baby every few
// months instead of rounding to nothing forever. (Thousandths lost any flow
// under 0.0005 a step outright: the carry rounded to 0 and was deleted.) Splits between destinations
// use largest-remainder rounding in a fixed key order, so the parts always sum
// to the whole and ties never depend on iteration order.

/** Millionths kept per carry (an integer, so the stored carry stays exact in JSON). */
export const CARRY_SCALE = 1_000_000;

/** Writes −0 as 0. JSON already does, but our hash and copy must too (A25). */
export function nz(x: number): number {
  return x === 0 ? 0 : x;
}

/** a / max(1, b): the engine's only form of division by a quantity that can be 0. */
export function div1(a: number, b: number): number {
  return a / (b > 1 ? b : 1);
}

/**
 * Rounds a flow toward zero and keeps the remainder under `key` in `carry`.
 * The carry is signed, so a money line that is sometimes negative still sums
 * exactly. A zero carry is deleted to keep the stored object small.
 */
export function takeCarry(carry: Record<string, number>, key: string, x: number): number {
  // A non-finite flow is a bug upstream. Posting nothing would hide it (the
  // books would still balance), so fail loudly: the driver reverts the month.
  if (!Number.isFinite(x)) throw new Error(`flow ${key} is ${x}`);
  const total = x + (carry[key] ?? 0) / CARRY_SCALE;
  let out = Math.trunc(total);
  let rem = Math.round((total - out) * CARRY_SCALE);
  if (rem >= CARRY_SCALE) {
    out += 1;
    rem -= CARRY_SCALE;
  } else if (rem <= -CARRY_SCALE) {
    out -= 1;
    rem += CARRY_SCALE;
  }
  if (rem === 0) delete carry[key];
  else carry[key] = rem;
  return nz(out);
}

/**
 * Splits a non-negative integer `total` in proportion to `weights` (largest
 * remainder; ties go to the lower index). All-zero weights give all zeros
 * except that nothing is lost: the whole total goes to index 0.
 */
export function largestRemainder(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || total <= 0) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += weights[i] > 0 ? weights[i] : 0;
  if (sum <= 0) {
    out[0] = total;
    return out;
  }
  const rems: number[] = new Array<number>(n);
  let given = 0;
  for (let i = 0; i < n; i++) {
    const exact = (total * (weights[i] > 0 ? weights[i] : 0)) / sum;
    const whole = Math.floor(exact);
    out[i] = whole;
    rems[i] = exact - whole;
    given += whole;
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => rems[b] - rems[a] || a - b);
  for (let j = 0; given < total && j < n; j++, given++) out[order[j]] += 1;
  return out;
}

/** Rounds to the nearest integer, halves away from zero, never −0. */
export function roundInt(x: number): number {
  return nz(x < 0 ? -Math.round(-x) : Math.round(x));
}

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s;
}

/** Basis points (1% = 100 bp) to a fraction. */
export function bp(x: number): number {
  return x / 10000;
}

/**
 * "£12,345" by our own arithmetic: the engine never formats with
 * toLocaleString or Intl (ICU differs between V8 and JavaScriptCore, A25).
 */
export function formatPounds(n: number): string {
  const neg = n < 0;
  let x = Math.round(neg ? -n : n);
  let s = '';
  do {
    const part = x % 1000;
    x = (x - part) / 1000;
    s = (x > 0 ? String(part + 1000).slice(1) : String(part)) + (s ? ',' + s : '');
  } while (x > 0);
  return (neg ? '−£' : '£') + s;
}
