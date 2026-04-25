import { describe, it, expect } from 'vitest';
import { computePolarised } from '$lib/health/analytics/polarised';

describe('computePolarised', () => {
  it('classifies 80/20 split as polarised', () => {
    const r = computePolarised([
      { z0: 0, z1: 50_000, z2: 30_000, z3: 0, z4: 15_000, z5: 5_000 },
    ]);
    expect(r.value.easyPct).toBeGreaterThanOrEqual(80);
    expect(r.value.hardPct).toBeGreaterThanOrEqual(10);
    expect(r.value.verdict).toBe('polarised');
  });

  it('flags junk-middle when Z3 dominates', () => {
    const r = computePolarised([
      { z0: 0, z1: 0, z2: 5_000, z3: 90_000, z4: 5_000, z5: 0 },
    ]);
    expect(r.value.verdict).toBe('junk-middle');
  });

  it('reports insufficient with no workouts', () => {
    const r = computePolarised([]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
