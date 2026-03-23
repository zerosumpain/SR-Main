import { startScheduler } from '$lib/health/scheduler';
import { orchestrator } from '$lib/jkai/orchestrator';

// Start the health data sync scheduler
startScheduler();

// Recover any in-progress builds on server startup
orchestrator.recoverOnStartup().catch((err) => {
  console.error('[jkai] Failed to recover build on startup:', err);
});

export const handle = async ({ event, resolve }) => {
  return resolve(event);
};
