// tests/lib/health/analytics/acwr.test.ts
import { describe, it, expect } from 'vitest';
import { computeACWR } from '$lib/health/analytics/acwr';

describe('computeACWR', () => {
  it('returns ratio ~1 for steady load', () => {
    const days = Array.from({ length: 28 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      load: 10,
    }));
    const r = computeACWR(days);
    expect(r.value.ratio).toBeGreaterThan(0.95);
    expect(r.value.ratio).toBeLessThan(1.05);
    expect(r.value.zone).toBe('optimal');
  });

  it('classifies sudden spike as caution or danger', () => {
    const baseline = Array.from({ length: 21 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`, load: 5,
    }));
    const spike = Array.from({ length: 7 }).map((_, i) => ({
      date: `2026-01-${String(i + 22).padStart(2, '0')}`, load: 25,
    }));
    const r = computeACWR([...baseline, ...spike]);
    expect(['caution', 'danger']).toContain(r.value.zone);
  });

  it('reports insufficient with < 14 days', () => {
    const r = computeACWR([{ date: '2026-01-01', load: 5 }]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
