// tests/lib/health/analytics/trimp.test.ts
import { describe, it, expect } from 'vitest';
import { trimpFromSamples, trimpFromAvg, type HrProfile } from '$lib/health/analytics/trimp';

const P: HrProfile = { hrRest: 50, hrMax: 190, sex: 'male' };

describe('trimpFromSamples', () => {
  it('matches the closed-form value for constant HR', () => {
    // 60 min at HR 120 → HRr = 0.5 → 60 × 0.5 × 0.64 × e^0.96 ≈ 50.1
    const samples: [number, number][] = Array.from({ length: 61 }, (_, i) => [i * 60, 120]);
    const t = trimpFromSamples(samples, P)!;
    expect(t).toBeGreaterThan(48);
    expect(t).toBeLessThan(52);
  });

  it('weights hard minutes exponentially more than easy ones', () => {
    const easy: [number, number][] = Array.from({ length: 31 }, (_, i) => [i * 60, 106]); // HRr .4
    const hard: [number, number][] = Array.from({ length: 31 }, (_, i) => [i * 60, 162]); // HRr .8
    expect(trimpFromSamples(hard, P)!).toBeGreaterThan(trimpFromSamples(easy, P)! * 2);
  });

  it('clamps dropout gaps instead of charging them', () => {
    const withGap: [number, number][] = [
      [0, 150],
      [1800, 150], // 30 min gap — must charge at most 5 min
      [1860, 150],
    ];
    const dense: [number, number][] = Array.from({ length: 7 }, (_, i) => [i * 60, 150]);
    expect(trimpFromSamples(withGap, P)!).toBeLessThanOrEqual(trimpFromSamples(dense, P)!);
  });

  it('returns null for unusable input', () => {
    expect(trimpFromSamples([], P)).toBeNull();
    expect(trimpFromSamples([[0, 120]], P)).toBeNull();
  });

  it('clamps HR outside the profile to the reserve bounds', () => {
    const below: [number, number][] = [
      [0, 40],
      [600, 40],
    ];
    expect(trimpFromSamples(below, P)).toBe(0);
  });
});

describe('trimpFromAvg', () => {
  it('agrees with the sample form for constant HR', () => {
    const samples: [number, number][] = Array.from({ length: 61 }, (_, i) => [i * 60, 120]);
    const fromSamples = trimpFromSamples(samples, P)!;
    const fromAvg = trimpFromAvg(3600, 120, P)!;
    expect(Math.abs(fromSamples - fromAvg)).toBeLessThan(2);
  });

  it('returns null for zero duration or HR', () => {
    expect(trimpFromAvg(0, 120, P)).toBeNull();
    expect(trimpFromAvg(3600, 0, P)).toBeNull();
  });
});
