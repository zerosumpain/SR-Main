import { describe, it, expect } from 'vitest';
import { computeRecoveryDebt } from '$lib/health/analytics/recovery-debt';

describe('computeRecoveryDebt', () => {
  it('returns zero debt when actual sleep meets need every night', () => {
    const series = Array.from({ length: 14 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      sleepNeedMin: 480, sleepActualMin: 480, strain: 12, recoveryScore: 70,
    }));
    const r = computeRecoveryDebt(series);
    expect(r.value.sleepDebtMin).toBe(0);
    expect(r.value.overdrawn).toBe(false);
  });

  it('flags overdrawn when accumulated debt > 240 min', () => {
    const series = Array.from({ length: 14 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      sleepNeedMin: 480, sleepActualMin: 420, strain: 14, recoveryScore: 55,
    }));
    const r = computeRecoveryDebt(series);
    expect(r.value.sleepDebtMin).toBeGreaterThan(240);
    expect(r.value.overdrawn).toBe(true);
  });

  it('reports insufficient with < 7 nights', () => {
    const r = computeRecoveryDebt([
      { date: '2026-01-01', sleepNeedMin: 480, sleepActualMin: 480, strain: 12, recoveryScore: 70 },
    ]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
