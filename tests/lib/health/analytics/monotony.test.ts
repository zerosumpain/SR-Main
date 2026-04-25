// tests/lib/health/analytics/monotony.test.ts
import { describe, it, expect } from 'vitest';
import { computeMonotony } from '$lib/health/analytics/monotony';

describe('computeMonotony', () => {
  it('returns high monotony for flat daily load', () => {
    const r = computeMonotony([10, 10, 10, 10, 10, 10, 10]);
    expect(r.value.monotony).toBeGreaterThan(50);  // SD≈0 → big number, capped
    expect(r.value.strain).toBeGreaterThan(0);
    expect(r.sufficiency).toBe('ok');
  });

  it('returns ~1 monotony for varied load', () => {
    const r = computeMonotony([0, 14, 0, 12, 0, 16, 0]);
    expect(r.value.monotony).toBeGreaterThan(0.5);
    expect(r.value.monotony).toBeLessThan(2);
  });

  it('reports insufficient when fewer than 7 days supplied', () => {
    const r = computeMonotony([10, 10]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
