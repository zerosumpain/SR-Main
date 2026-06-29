import type { PageServerLoad } from './$types';
import { getHealthSeries30d } from '$lib/health/series-30d-service';
import { getFeaturedActivities } from '$lib/health/featured-activities-service';
import { getReadiness } from '$lib/health/readiness-service';
import { getTrainingLoad } from '$lib/health/training-load-service';
import { getMonotony } from '$lib/health/services/monotony-service';
import { getRecoveryDebt } from '$lib/health/services/recovery-debt-service';
import { getAutonomicBalance } from '$lib/health/services/autonomic-balance-service';
import { getSleepRegularity } from '$lib/health/services/sleep-regularity-service';
import { getCircadianAlignment } from '$lib/health/services/circadian-service';
import { getVO2Max } from '$lib/health/services/vo2max-service';
import { getPolarised } from '$lib/health/services/polarised-service';
import { getStats } from '$lib/health/stats-service';

// Each analytic is loaded server-side (anon users can't hit the auth-gated
// /api/health/* endpoints). A single failing service must never blank the page,
// so every call is wrapped to resolve to null on error and the section fails soft.
async function safe<T>(label: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.warn(`[health] analytic "${label}" failed:`, (err as Error)?.message);
    return null;
  }
}

export const load: PageServerLoad = async () => {
  const [
    data,
    featuredActivities,
    readiness,
    trainingLoad,
    monotony,
    recoveryDebt,
    autonomic,
    sleepRegularity,
    circadian,
    vo2max,
    polarised,
    stats,
  ] = await Promise.all([
    getHealthSeries30d(),
    getFeaturedActivities(),
    safe('readiness', getReadiness()),
    safe('training-load', getTrainingLoad()),
    safe('monotony', getMonotony()),
    safe('recovery-debt', getRecoveryDebt()),
    safe('autonomic', getAutonomicBalance()),
    safe('sleep-regularity', getSleepRegularity()),
    safe('circadian', getCircadianAlignment()),
    safe('vo2max', getVO2Max()),
    safe('polarised', getPolarised()),
    safe('stats', getStats()),
  ]);

  return {
    ...data,
    featuredActivities,
    analytics: {
      readiness,
      trainingLoad,
      monotony,
      recoveryDebt,
      autonomic,
      sleepRegularity,
      circadian,
      vo2max,
      polarised,
      stats,
    },
    loadedAt: new Date().toISOString(),
  };
};
