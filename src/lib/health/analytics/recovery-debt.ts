import type { MetricResult } from './types';

export type RecoverySample = {
  date: string;
  /** WHOOP baseline + strain + nap adjustment. Carried sleep debt is excluded. */
  freshSleepNeedMin: number;
  sleepActualMin: number;
  /** WHOOP's own carried-debt adjustment, exposed as context but never summed. */
  whoopDebtAdjustmentMin: number;
  strain: number;
  recoveryScore: number;
};

export type RecoveryDebtResult = {
  /** Signed actual minus fresh need over the latest seven complete sleeps. */
  averageBalanceMin: number;
  averageActualMin: number;
  averageNeedMin: number;
  /** Actual-sleep change against the preceding (up to) 21 complete sleeps. */
  trendActualMin: number | null;
  nightsBelowNeed: number;
  latestWhoopDebtAdjustmentMin: number | null;
  strainRecoveryBalance: number;     // mean(strain_7d) − mean(recovery_7d)/10 — >0 means strain dominant
  short: boolean;
  /** Trailing seven-night average balance, so this curve can improve as well as worsen. */
  series: { date: string; balanceMin: number }[];
};

/**
 * A seven-night average more than 30 minutes below fresh need is worth acting
 * on. This is deliberately a per-night operating threshold, not a claim that
 * every historical minute can or should be repaid.
 */
export const SLEEP_BALANCE_SHORTFALL_MIN = 30;
export const RECENT_SLEEP_NIGHTS = 7;

/**
 * mean(strain_7d) − mean(recovery_7d)/10 past which strain is dominant.
 * Whoop strain runs 0–21 and recovery 0–100, so the recovery side is divided
 * by ten before the gap is taken.
 */
export const STRAIN_BALANCE_FLAG = 8;

export function computeRecoveryDebt(series: RecoverySample[]): MetricResult<RecoveryDebtResult> {
  // Cycles and recoveries can exist without a scored sleep. They must not make
  // this metric look sufficient or become zero-balance nights.
  const sorted = [...series]
    .filter((sample) => sample.freshSleepNeedMin > 0 && sample.sleepActualMin > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < RECENT_SLEEP_NIGHTS) {
    return {
      value: {
        averageBalanceMin: 0,
        averageActualMin: 0,
        averageNeedMin: 0,
        trendActualMin: null,
        nightsBelowNeed: 0,
        latestWhoopDebtAdjustmentMin: null,
        strainRecoveryBalance: 0,
        short: false,
        series: [],
      },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: sorted.length,
    };
  }

  const average = (values: number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const recent = sorted.slice(-RECENT_SLEEP_NIGHTS);
  const preceding = sorted.slice(-28, -RECENT_SLEEP_NIGHTS);
  const averageActualMin = average(recent.map((sample) => sample.sleepActualMin));
  const averageNeedMin = average(recent.map((sample) => sample.freshSleepNeedMin));
  const averageBalanceMin = averageActualMin - averageNeedMin;
  const trendActualMin =
    preceding.length >= RECENT_SLEEP_NIGHTS
      ? averageActualMin - average(preceding.map((sample) => sample.sleepActualMin))
      : null;

  // Each point is the seven-night mean ending on that date. Unlike the old
  // cumulative curve this can genuinely turn when sleep improves.
  const balanceSeries: { date: string; balanceMin: number }[] = [];
  for (let index = RECENT_SLEEP_NIGHTS - 1; index < sorted.length; index++) {
    const window = sorted.slice(index - RECENT_SLEEP_NIGHTS + 1, index + 1);
    balanceSeries.push({
      date: sorted[index].date,
      balanceMin: average(
        window.map((sample) => sample.sleepActualMin - sample.freshSleepNeedMin),
      ),
    });
  }

  const meanStrain = average(recent.map((sample) => sample.strain));
  const meanRecovery = average(recent.map((sample) => sample.recoveryScore));
  // Whoop strain ranges 0–21; recovery 0–100. Normalise recovery into the strain scale (÷10) then take the gap.
  const balance = meanStrain - meanRecovery / 10;
  const short = averageBalanceMin < -SLEEP_BALANCE_SHORTFALL_MIN;
  return {
    value: {
      averageBalanceMin,
      averageActualMin,
      averageNeedMin,
      trendActualMin,
      nightsBelowNeed: recent.filter(
        (sample) => sample.sleepActualMin < sample.freshSleepNeedMin,
      ).length,
      latestWhoopDebtAdjustmentMin: recent.at(-1)?.whoopDebtAdjustmentMin ?? null,
      strainRecoveryBalance: balance,
      short,
      series: balanceSeries.slice(-28),
    },
    sufficiency: sorted.length >= 28 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: sorted.length,
  };
}
