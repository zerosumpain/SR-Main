import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  const fetchJson = (path: string) =>
    fetch(path).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  const [
    readiness, sparklines, trainingLoad, sleepAnalysis, timeline, bodySignals, stats,
    autonomic, sleepRegularity, circadian, recoveryDebt, acwr, monotony, vo2max, polarised,
  ] = await Promise.all([
    fetchJson('/api/health/readiness'),
    fetchJson('/api/health/sparklines'),
    fetchJson('/api/health/training-load'),
    fetchJson('/api/health/sleep-analysis'),
    fetchJson('/api/health/timeline?limit=10'),
    fetchJson('/api/health/body-signals'),
    fetchJson('/api/health/stats'),
    fetchJson('/api/health/autonomic'),
    fetchJson('/api/health/sleep-regularity'),
    fetchJson('/api/health/circadian'),
    fetchJson('/api/health/recovery-debt'),
    fetchJson('/api/health/acwr'),
    fetchJson('/api/health/monotony'),
    fetchJson('/api/health/vo2max'),
    fetchJson('/api/health/polarised'),
  ]);

  const syncState = await fetchJson('/api/health/sync-state');

  return {
    readiness, sparklines, trainingLoad, sleepAnalysis, timeline, bodySignals, stats,
    autonomic, sleepRegularity, circadian, recoveryDebt, acwr, monotony, vo2max, polarised,
    syncState, loadedAt: new Date().toISOString(),
  };
};
