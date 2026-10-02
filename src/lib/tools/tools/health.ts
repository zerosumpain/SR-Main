import { register } from '../registry-internal';
import { getFromExtracted } from '$lib/server/extracted-app';

// These five used to `await import('$lib/health/<x>-service')` and call the
// service in this process. Health is its own application now, so each is a
// service-lane call to the endpoint that wraps the same function.
//
// The dynamic import was already deliberate — registration happens on every
// import of the tool registry, including paths that only enumerate tool
// schemas, so the analytics were loaded inside the handler rather than at the
// top. A call has that property for free.
//
// Payloads are passed through unexamined, and the `data` type is deliberately
// `unknown`. The consumer is a language model handed the JSON as text; this
// file never indexes a field, so pinning a shape here would be a contract
// nobody reads and everybody has to update. That is the opposite of the chat
// context panel, which renders named fields and therefore shares a typed
// payload file with SR-Health.
//
// A failure throws, exactly as a failing service call did before. What is new
// is that "Health is not answering" is now a reachable state at all.

const read = async (path: string) => ({
	success: true as const,
	data: await getFromExtracted<unknown>('health', path),
});

register({
  name: 'health_stats',
  description: 'Get weekly health metrics (activity count, distance, duration, elevation, recovery score, sleep average) and all-time personal records',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  toolset: 'health',
  handler: async () => read('/api/health/stats'),
});

register({
  name: 'health_readiness',
  description: 'Get composite readiness score with recovery, HRV trend, sleep quality, load balance factors, zone classification, and recommendation',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  toolset: 'health',
  handler: async () => read('/api/health/readiness'),
});

register({
  name: 'health_sleep',
  description: 'Get latest sleep analysis (duration, light/deep/REM percentages, performance score) and 14-day trend',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  toolset: 'health',
  handler: async () => read('/api/health/sleep'),
});

register({
  name: 'health_training_load',
  description: 'Get training load analysis: acute/chronic load ratio, zone (optimal/caution/danger), 30-day history',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  toolset: 'health',
  handler: async () => read('/api/health/training-load'),
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
  toolset: 'health',
  handler: async (args) => {
    // Sent as written; the endpoint clamps them. These arguments are chosen by
    // a language model, so `limit` is whatever it typed, and the bound belongs
    // on the side that would otherwise read the whole table.
    const page = (args.page as number) || 1;
    const limit = (args.limit as number) || 20;
    return read(`/api/health/timeline?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`);
  },
});
