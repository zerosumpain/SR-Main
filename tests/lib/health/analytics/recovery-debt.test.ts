import { describe, it, expect } from 'vitest';
import { computeRecoveryDebt } from '$lib/health/analytics/recovery-debt';

function nights(
  count: number,
  values: (index: number) => Partial<{
    need: number;
    actual: number;
    debtAdjustment: number;
    strain: number;
    recovery: number;
  }> = () => ({}),
) {
  return Array.from({ length: count }, (_, index) => {
    const value = values(index);
    return {
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      freshSleepNeedMin: value.need ?? 480,
      sleepActualMin: value.actual ?? 480,
      whoopDebtAdjustmentMin: value.debtAdjustment ?? 0,
      strain: value.strain ?? 12,
      recoveryScore: value.recovery ?? 70,
    };
  });
}

describe('computeRecoveryDebt', () => {
  it('reports a signed seven-night balance rather than cumulative debt', () => {
    const result = computeRecoveryDebt(nights(7));
    expect(result.value.averageBalanceMin).toBe(0);
    expect(result.value.averageActualMin).toBe(480);
    expect(result.value.averageNeedMin).toBe(480);
    expect(result.value.short).toBe(false);
  });

  it('flags an average shortfall beyond 30 minutes per night', () => {
    const result = computeRecoveryDebt(nights(7, () => ({ actual: 420 })));
    expect(result.value.averageBalanceMin).toBe(-60);
    expect(result.value.nightsBelowNeed).toBe(7);
    expect(result.value.short).toBe(true);
  });

  it('lets longer nights offset shorter nights', () => {
    const result = computeRecoveryDebt(
      nights(7, (index) => ({ actual: index < 3 ? 420 : 525 })),
    );
    expect(result.value.averageBalanceMin).toBeCloseTo(0, 5);
    expect(result.value.nightsBelowNeed).toBe(3);
    expect(result.value.short).toBe(false);
  });

  it('does not add WHOOP carried debt into the balance', () => {
    const result = computeRecoveryDebt(
      nights(7, () => ({ actual: 480, debtAdjustment: 180 })),
    );
    expect(result.value.averageBalanceMin).toBe(0);
    expect(result.value.latestWhoopDebtAdjustmentMin).toBe(180);
  });

  it('produces a rolling curve that can improve', () => {
    const result = computeRecoveryDebt(
      nights(14, (index) => ({ actual: index < 7 ? 420 : 510 })),
    );
    expect(result.value.series[0].balanceMin).toBe(-60);
    expect(result.value.series.at(-1)?.balanceMin).toBe(30);
    expect(result.value.trendActualMin).toBe(90);
  });

  it('reports insufficient with fewer than seven valid sleeps', () => {
    const result = computeRecoveryDebt([
      ...nights(6),
      {
        date: '2026-01-07',
        freshSleepNeedMin: 0,
        sleepActualMin: 0,
        whoopDebtAdjustmentMin: 0,
        strain: 12,
        recoveryScore: 70,
      },
    ]);
    expect(result.sufficiency).toBe('insufficient');
    expect(result.sampleSize).toBe(6);
  });
});
