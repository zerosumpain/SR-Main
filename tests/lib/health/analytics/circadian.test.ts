// tests/lib/health/analytics/circadian.test.ts
import { describe, it, expect } from 'vitest';
import { computeCircadianAlignment } from '$lib/health/analytics/circadian';

describe('computeCircadianAlignment', () => {
  it('returns ~0 drift when last 7 nights match the prior baseline', () => {
    const nights = Array.from({ length: 28 }).map((_, i) => ({
      startLocalIso: `2026-01-${String(i + 1).padStart(2, '0')}T23:00:00Z`,
      endLocalIso: `2026-01-${String(i + 2).padStart(2, '0')}T07:00:00Z`,
    }));
    const r = computeCircadianAlignment(nights);
    expect(Math.abs(r.value.driftHours)).toBeLessThan(0.05);
    expect(r.sufficiency).toBe('ok');
  });

  it('reports positive drift when recent nights are later', () => {
    const baseline = Array.from({ length: 21 }).map((_, i) => ({
      startLocalIso: `2026-01-${String(i + 1).padStart(2, '0')}T23:00:00Z`,
      endLocalIso: `2026-01-${String(i + 2).padStart(2, '0')}T07:00:00Z`,
    }));
    const recent = Array.from({ length: 7 }).map((_, i) => ({
      startLocalIso: `2026-01-${String(i + 22).padStart(2, '0')}T01:00:00Z`,
      endLocalIso: `2026-01-${String(i + 23).padStart(2, '0')}T09:00:00Z`,
    }));
    const r = computeCircadianAlignment([...baseline, ...recent]);
    expect(r.value.driftHours).toBeGreaterThan(1.5);
  });

  it('reports insufficient with < 14 nights', () => {
    const r = computeCircadianAlignment([
      { startLocalIso: '2026-01-01T23:00:00Z', endLocalIso: '2026-01-02T07:00:00Z' },
    ]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
