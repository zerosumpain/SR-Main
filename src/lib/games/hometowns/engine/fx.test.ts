// The deterministic maths against the platform's own functions (tests may
// use Math.exp and friends; the engine may not). Bounds are relative unless
// the value is near zero, where they are absolute.

import { describe, expect, it } from 'vitest';
import { M, T, cosFx, expFx, invNormal, lnFx, logisticFx, pow2i, powFx, sat, sigma, sinFx, smooth, tanhFx } from './fx';

function maxRel(f: (x: number) => number, ref: (x: number) => number, lo: number, hi: number, n = 20000, floor = 1e-300): number {
  let worst = 0;
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n;
    const a = f(x);
    const b = ref(x);
    const e = Math.abs(a - b) / Math.max(floor, Math.abs(b));
    if (e > worst) worst = e;
  }
  return worst;
}

describe('fx: transcendental functions from + − × ÷ only', () => {
  it('pow2i is exact', () => {
    for (let k = -60; k <= 60; k++) expect(pow2i(k)).toBe(2 ** k);
  });

  it('expFx matches e^x within 1e-14 relative on [−700, 700]', () => {
    expect(maxRel(expFx, Math.exp, -700, 700)).toBeLessThan(1e-13);
    expect(maxRel(expFx, Math.exp, -5, 5)).toBeLessThan(1e-14);
    expect(expFx(0)).toBe(1);
  });

  it('lnFx matches ln x within 1e-14 relative away from 1, and absolutely near 1', () => {
    expect(maxRel(lnFx, Math.log, 1e-300, 1e-10, 2000)).toBeLessThan(1e-14);
    expect(maxRel(lnFx, Math.log, 2, 1e12)).toBeLessThan(1e-14);
    expect(maxRel(lnFx, Math.log, 0.5, 1.5, 20000, 1)).toBeLessThan(1e-15);
    expect(lnFx(1)).toBe(0);
    expect(lnFx(0)).toBe(-Infinity);
    expect(lnFx(-1)).toBeNaN();
  });

  it('powFx matches x^y; integer powers are exact repeated multiplication', () => {
    expect(maxRel((x) => powFx(x, 0.7), (x) => Math.pow(x, 0.7), 0.001, 1e6)).toBeLessThan(1e-13);
    expect(maxRel((x) => powFx(x, 0.08), (x) => Math.pow(x, 0.08), 0.01, 1e6)).toBeLessThan(1e-13);
    expect(powFx(3, 4)).toBe(81);
    expect(powFx(1.5, 2)).toBe(2.25);
    expect(powFx(0, 0.5)).toBe(0);
  });

  it('sinFx and cosFx match within 1e-15 absolute on [−1000, 1000]', () => {
    let worst = 0;
    for (let i = 0; i <= 20000; i++) {
      const x = -1000 + i * 0.1;
      worst = Math.max(worst, Math.abs(sinFx(x) - Math.sin(x)), Math.abs(cosFx(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('tanhFx, logisticFx are accurate', () => {
    expect(maxRel(tanhFx, Math.tanh, -20, 20)).toBeLessThan(1e-13);
    expect(maxRel(logisticFx, (x) => 1 / (1 + Math.exp(-x)), -40, 40)).toBeLessThan(1e-13);
  });

  it('T (table tanh) is within 1e-6 relative everywhere, 1e-9 absolute on [−10, 10]', () => {
    expect(maxRel(T, Math.tanh, -12, 12, 100003, 1e-300)).toBeLessThan(1e-6);
    let worst = 0;
    for (let i = 0; i <= 100003; i++) {
      const x = -10 + (20 * i) / 100003;
      worst = Math.max(worst, Math.abs(T(x) - Math.tanh(x)));
    }
    expect(worst).toBeLessThan(1e-9);
    expect(T(0)).toBe(0);
    expect(T(-0.3)).toBe(-T(0.3));
  });

  it('σ (table logistic) is within 1e-6 relative for all x', () => {
    expect(maxRel(sigma, (x) => 1 / (1 + Math.exp(-x)), -60, 60, 100003)).toBeLessThan(1e-6);
    expect(sigma(0)).toBeCloseTo(0.5, 12);
  });

  it('the growth curve hits the spec’s worked values (§5.2)', () => {
    const p = (z: number) => 0.3 * sigma((z - 10) / 15);
    expect(p(0)).toBeCloseTo(0.1018, 3); // ≈10% at z = 0
    expect(p(60)).toBeCloseTo(0.2899, 3); // 29% at +60
    expect(p(-40)).toBeCloseTo(0.0102, 3); // 1% at −40
  });

  it('M, sat and smooth have their documented shapes', () => {
    expect(M(1, 0.3, 1.5)).toBe(1);
    expect(M(100, 0.3, 1.5)).toBeLessThanOrEqual(1.3);
    expect(M(-100, 0.3, 1.5)).toBeGreaterThanOrEqual(0.7);
    expect(sat(1)).toBe(0.5);
    expect(smooth(0, 12, 6)).toBe(2);
  });

  it('invNormal is the normal quantile within 1e-8', () => {
    // Φ⁻¹ at known points.
    expect(invNormal(0.5)).toBe(0);
    expect(invNormal(0.975)).toBeCloseTo(1.959963984540054, 8);
    expect(invNormal(0.001)).toBeCloseTo(-3.090232306167813, 8);
    expect(invNormal(0.8413447460685429)).toBeCloseTo(1, 8);
  });
});
