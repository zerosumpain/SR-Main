import { startScheduler } from '$lib/health/scheduler';

// Start the health data sync scheduler
startScheduler();

export const handle = async ({ event, resolve }) => {
  return resolve(event);
};
