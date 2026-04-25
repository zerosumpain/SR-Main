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
  const overdrawn = cumDebt > 240 || balance > 8;
  return {
    value: { sleepDebtMin: cumDebt, strainRecoveryBalance: balance, overdrawn, series: debtSeries },
    sufficiency: sorted.length >= 14 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: sorted.length,
  };
}
