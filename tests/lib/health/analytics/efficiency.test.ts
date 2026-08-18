// tests/lib/health/analytics/efficiency.test.ts
import { describe, it, expect } from 'vitest';
import {
  efficiencyFactor,
  splitHalves,
  decoupling,
} from '$lib/health/analytics/efficiency';

describe('efficiencyFactor', () => {
  it('computes metres/min per bpm', () => {
    // 10 km in 50 min at 150 bpm → 200 m/min / 150 = 1.333
    expect(efficiencyFactor(10000, 3000, 150)).toBeCloseTo(1.333, 2);
  });

  it('returns null when any input is missing or zero', () => {
    expect(efficiencyFactor(null, 3000, 150)).toBeNull();
    expect(efficiencyFactor(10000, 0, 150)).toBeNull();
    expect(efficiencyFactor(10000, 3000, null)).toBeNull();
  });
});

// A straight north-going track: 1° lat ≈ 111.19 km, so 0.00001° ≈ 1.11 m.
function straightTrack(
  seconds: number,
  metresPerSecond: number,
): Array<[number, number, number | null, number]> {
  const degPerMetre = 1 / 111194.9;
  return Array.from({ length: seconds + 1 }, (_, t) => [
    -1.5,
    52 + t * metresPerSecond * degPerMetre,
    null,
    t,
  ]);
}

describe('splitHalves + decoupling', () => {
  it('reports ~0% when pace and HR hold steady', () => {
    const coords = straightTrack(1200, 3);
    const hr: [number, number][] = Array.from({ length: 121 }, (_, i) => [i * 10, 150]);
    const d = decoupling(splitHalves(coords, hr));
    expect(d).not.toBeNull();
    expect(Math.abs(d!)).toBeLessThan(1);
  });

  it('reports positive drift when HR rises at held pace', () => {
    const coords = straightTrack(1200, 3);
    const hr: [number, number][] = Array.from({ length: 121 }, (_, i) => [
      i * 10,
      i < 60 ? 140 : 154, // +10% HR in the second half
    ]);
    const d = decoupling(splitHalves(coords, hr));
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(15);
  });

  it('returns null on thin data', () => {
    expect(splitHalves([], [])).toBeNull();
    expect(decoupling(null)).toBeNull();
  });
});
