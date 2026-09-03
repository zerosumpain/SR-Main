// src/lib/health/derived.server.ts
//
// The /health hub's DERIVED layer — moves, tripwires, experiments, verdict —
// assembled outside the route so something other than the page can read it.
//
// A parallel assembly rather than a refactor of `/health/+page.server.ts`:
// that route was rebuilt twice in the last week and carries owner/public
// projections this consumer has no use for. The daydream signal registrar
// samples this once a day; a little drift from the page is harmless there.
// The route can adopt this function later.

import { getReadiness } from '$lib/health/readiness-service';
import { getMonotony } from '$lib/health/services/monotony-service';
import { getRecoveryDebt } from '$lib/health/services/recovery-debt-service';
import { getAutonomicBalance } from '$lib/health/services/autonomic-balance-service';
import { getSleepRegularity } from '$lib/health/services/sleep-regularity-service';
import { getCircadianAlignment } from '$lib/health/services/circadian-service';
import { getVO2Max } from '$lib/health/services/vo2max-service';
import { getPolarised } from '$lib/health/services/polarised-service';
import { getTrailsDashboard } from '$lib/trails/physio-service';
import { acwrSeries, preferredACWR } from '$lib/health/analytics/acwr';
import { localToday } from '$lib/health/day';
import { computeMoves } from '$lib/health/moves';
import { computeTripwires, weeklyVolumeSummary } from '$lib/health/tripwires';
import { computeExperiments } from '$lib/health/experiments';
import { computeForecast } from '$lib/health/analytics/forecast';
import { trend } from '$lib/trails/physio-service';

async function safe<T>(label: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.warn(`[health-derived] ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
function safeSync<T>(label: string, f: () => T): T | null {
  try {
    return f();
  } catch (err) {
    console.warn(`[health-derived] ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface HealthDerived {
  today: string;
  readinessScore: number | null;
  moves: number;
  tripwiresTripped: number;
  tripwiresClose: number;
  experimentLive: number;
  experimentsQueued: number;
  /** Projected change in ACWR over the forecast horizon, if a forecast exists. */
  acwrForecastDelta: number | null;
  volumeWeekKm: number | null;
}

export async function computeHealthDerived(): Promise<HealthDerived> {
  const [readiness, monotony, recoveryDebt, autonomic, sleepRegularity, circadian, vo2max, polarised, dashboard] =
    await Promise.all([
      safe('readiness', getReadiness()),
      safe('monotony', getMonotony()),
      safe('recovery-debt', getRecoveryDebt()),
      safe('autonomic', getAutonomicBalance()),
      safe('sleep-regularity', getSleepRegularity()),
      safe('circadian', getCircadianAlignment()),
      safe('vo2max', getVO2Max()),
      safe('polarised', getPolarised()),
      safe('trails-dashboard', getTrailsDashboard()),
    ]);
  const today = localToday();
  const acwr = preferredACWR(dashboard?.load.trimpAcwr, dashboard?.load.strainAcwr);
  const efficiency = dashboard?.efficiency ?? null;
  const volume = weeklyVolumeSummary(dashboard?.weeks, today);
  const instrumentInputs = {
    readiness: readiness ? { score: readiness.score, label: readiness.label } : null,
    acwr,
    monotony,
    polarised,
    sri: sleepRegularity,
    circadian,
    autonomic,
    recoveryDebt,
    efficiency: efficiency?.bkm ?? null,
    vo2: vo2max,
    volume: volume ? { weekKm: volume.weekKm, medianKm: volume.medianKm } : null,
  };
  const moves = safeSync('moves', () => computeMoves(instrumentInputs)) ?? [];
  const tripwires =
    safeSync('tripwires', () =>
      computeTripwires({
        today,
        recoveryDebt,
        acwr,
        vo2: vo2max,
        hrv: dashboard?.hrv ?? null,
        rhr: dashboard?.rhr ?? null,
        recovery: dashboard?.recovery ?? null,
        weeks: dashboard?.weeks ?? null,
        segments: null,
      }),
    ) ?? [];
  const experiments =
    safeSync('experiments', () =>
      computeExperiments({
        today,
        sri: sleepRegularity,
        circadian,
        recoveryDebt,
        acwr,
        polarised,
        volume: instrumentInputs.volume,
        weeks: dashboard?.weeks ?? null,
      }),
    ) ?? [];
  const acwrForecast = safeSync('forecast-acwr', () =>
    dashboard?.load.days.length ? computeForecast(trend(acwrSeries(dashboard.load.days)), { min: 0 }) : null,
  );
  const acwrForecastDelta = acwrForecast?.value ? acwrForecast.value.then - acwrForecast.value.now : null;

  return {
    today,
    readinessScore: readiness?.score ?? null,
    moves: moves.length,
    tripwiresTripped: tripwires.filter((t) => t.state === 'TRIPPED').length,
    tripwiresClose: tripwires.filter((t) => t.state === 'CLOSE').length,
    experimentLive: experiments.some((e) => e.state === 'LIVE') ? 1 : 0,
    experimentsQueued: experiments.filter((e) => e.state === 'QUEUED').length,
    acwrForecastDelta: Number.isFinite(acwrForecastDelta as number) ? (acwrForecastDelta as number) : null,
    volumeWeekKm: volume?.weekKm ?? null,
  };
}
