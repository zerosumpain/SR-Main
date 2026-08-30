import type { MetricResult } from './types';

export type RecoverySample = {
  date: string;
  sleepNeedMin: number;
  sleepActualMin: number;
  strain: number;
  recoveryScore: number;
};

export type RecoveryDebtResult = {
  sleepDebtMin: number;
  strainRecoveryBalance: number;     // mean(strain_7d) − mean(recovery_7d)/10 — >0 means strain dominant
  overdrawn: boolean;
  series: { date: string; debt: number }[];
};

/**
 * Cumulative 14-day sleep shortfall, in minutes, past which the debt is flagged.
 * Four hours: one bad night is not a debt, a fortnight of forty-minute
 * shortfalls is.
 */
export const SLEEP_DEBT_FLAG_MIN = 240;

/**
 * mean(strain_7d) − mean(recovery_7d)/10 past which strain is dominant.
 * Whoop strain runs 0–21 and recovery 0–100, so the recovery side is divided
 * by ten before the gap is taken.
 */
export const STRAIN_BALANCE_FLAG = 8;

export function computeRecoveryDebt(series: RecoverySample[]): MetricResult<RecoveryDebtResult> {
  if (series.length < 7) {
    return {
      value: { sleepDebtMin: 0, strainRecoveryBalance: 0, overdrawn: false, series: [] },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: series.length,
    };
  }
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  let cumDebt = 0;
  const debtSeries: { date: string; debt: number }[] = [];
  for (const s of sorted.slice(-14)) {
    const nightly = Math.max(0, s.sleepNeedMin - s.sleepActualMin);
    cumDebt += nightly;
    debtSeries.push({ date: s.date, debt: cumDebt });
  }
  const last7 = sorted.slice(-7);
  const meanStrain = last7.reduce((a, b) => a + b.strain, 0) / last7.length;
  const meanRecovery = last7.reduce((a, b) => a + b.recoveryScore, 0) / last7.length;
  // Whoop strain ranges 0–21; recovery 0–100. Normalise recovery into the strain scale (÷10) then take the gap.
  const balance = meanStrain - meanRecovery / 10;
  const overdrawn = cumDebt > SLEEP_DEBT_FLAG_MIN || balance > STRAIN_BALANCE_FLAG;
  return {
    value: { sleepDebtMin: cumDebt, strainRecoveryBalance: balance, overdrawn, series: debtSeries },
    sufficiency: sorted.length >= 14 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: sorted.length,
  };
}
