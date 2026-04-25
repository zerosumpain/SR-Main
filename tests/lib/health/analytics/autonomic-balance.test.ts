// tests/lib/health/analytics/autonomic-balance.test.ts
import { describe, it, expect } from 'vitest';
import { computeAutonomicBalance } from '$lib/health/analytics/autonomic-balance';

describe('computeAutonomicBalance', () => {
  it('returns mid score (~50) when 7d trends match 28d baseline', () => {
    const series = Array.from({ length: 28 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      hrv: 50,
      rhr: 60,
    }));
    const r = computeAutonomicBalance(series);
    expect(r.value.score).toBeGreaterThan(40);
    expect(r.value.score).toBeLessThan(60);
    expect(r.sufficiency).toBe('ok');
  });

  it('returns higher score when recent HRV is high and RHR is low', () => {
    const baseline = Array.from({ length: 21 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`, hrv: 50, rhr: 60,
    }));
    const recent = Array.from({ length: 7 }).map((_, i) => ({
      date: `2026-01-${String(i + 22).padStart(2, '0')}`, hrv: 70, rhr: 52,
    }));
    const r = computeAutonomicBalance([...baseline, ...recent]);
    expect(r.value.score).toBeGreaterThan(70);
  });

  it('returns insufficient with < 14 days', () => {
    const r = computeAutonomicBalance([
      { date: '2026-01-01', hrv: 50, rhr: 60 },
    ]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
