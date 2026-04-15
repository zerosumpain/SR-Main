import { register } from '../registry-internal';

register({
  name: 'health_stats',
  description: 'Get weekly health metrics (activity count, distance, duration, elevation, recovery score, sleep average) and all-time personal records',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  handler: async () => {
    const { getStats } = await import('$lib/health/stats-service');
    return { success: true, data: await getStats() };
  },
});

register({
  name: 'health_readiness',
  description: 'Get composite readiness score with recovery, HRV trend, sleep quality, load balance factors, zone classification, and recommendation',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  handler: async () => {
    const { getReadiness } = await import('$lib/health/readiness-service');
    return { success: true, data: await getReadiness() };
  },
});

register({
  name: 'health_sleep',
  description: 'Get latest sleep analysis (duration, light/deep/REM percentages, performance score) and 14-day trend',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  handler: async () => {
    const { getSleepAnalysis } = await import('$lib/health/sleep-analysis-service');
    return { success: true, data: await getSleepAnalysis() };
  },
});

register({
  name: 'health_training_load',
  description: 'Get training load analysis: acute/chronic load ratio, zone (optimal/caution/danger), 30-day history',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  handler: async () => {
    const { getTrainingLoad } = await import('$lib/health/training-load-service');
    return { success: true, data: await getTrainingLoad() };
  },
});

register({
  name: 'health_timeline',
  description: 'Get paginated timeline of recent health events (activities, workouts, sleep, recovery)',
  parameters: {
    type: 'object',
    properties: {
      page: { type: 'number', description: 'Page number (default 1)' },
      limit: { type: 'number', description: 'Items per page (default 20)' },
    },
  },
  category: 'Health Data',
  handler: async (args) => {
    const { getTimeline } = await import('$lib/health/timeline-service');
    const page = (args.page as number) || 1;
    const limit = (args.limit as number) || 20;
    return { success: true, data: await getTimeline(page, limit) };
  },
});
