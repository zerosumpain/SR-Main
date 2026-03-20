import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  const [readiness, sparklines, trainingLoad, sleepAnalysis, timeline, bodySignals, stats] =
    await Promise.all([
      fetch('/api/health/readiness').then((r) => r.json()).catch(() => null),
      fetch('/api/health/sparklines').then((r) => r.json()).catch(() => null),
      fetch('/api/health/training-load').then((r) => r.json()).catch(() => null),
      fetch('/api/health/sleep-analysis').then((r) => r.json()).catch(() => null),
      fetch('/api/health/timeline?limit=10').then((r) => r.json()).catch(() => null),
      fetch('/api/health/body-signals').then((r) => r.json()).catch(() => null),
      fetch('/api/health/stats').then((r) => r.json()).catch(() => null),
    ]);

  return { readiness, sparklines, trainingLoad, sleepAnalysis, timeline, bodySignals, stats };
};
