/**
 * #19 DURABLE RUN-WORKER — standalone entry point.
 *
 * ADDITIVE + FEATURE-FLAGGED. This is a SEPARATE process from the SvelteKit web
 * app. It polls the DB-backed run queue (workflow_runs + lease columns) and
 * executes claimed runs via the existing engine, so a deploy/restart/OOM of the
 * web process no longer kills in-flight workflow runs.
 *
 * Launch (production / homeserv):
 *   1. Build once:   node packages/jkai-run-worker/build.mjs
 *   2. Run:          JKAI_RUN_WORKER=1 node packages/jkai-run-worker/dist/start.js
 *
 * Required env (same .env the SvelteKit app reads — e.g. via systemd
 * EnvironmentFile=): DATABASE_URL, plus JKAI_RUN_WORKER=1 to actually start.
 * Optional tuning: JKAI_RUN_WORKER_POLL_MS, JKAI_RUN_WORKER_LEASE_MS.
 *
 * IMPORTANT: this entry sets JKAI_BUILDER_PROCESS=1 so that importing
 * $lib/workflows in this process does NOT boot the web app's platform services
 * (WhatsApp socket, scheduler, reaper, memory review). The worker only needs
 * the engine + queue. Leader election for the cron lane is owned by whichever
 * process holds the advisory lock (see leader-lock.ts); the worker process does
 * not run the scheduler.
 */

// Set BEFORE importing $lib/workflows so its module-level boot guards see it.
process.env.JKAI_BUILDER_PROCESS = '1';

import { startRunWorker, stopRunWorker } from '$lib/workflows/run-worker';

async function main(): Promise<void> {
  if (process.env.JKAI_RUN_WORKER !== '1') {
    console.error('[run-worker-entry] JKAI_RUN_WORKER must be set to "1" to start the worker. Exiting.');
    process.exit(1);
  }

  startRunWorker();

  const shutdown = async (sig: string) => {
    console.log(`[run-worker-entry] received ${sig} — draining`);
    try {
      await stopRunWorker();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  console.log('[run-worker-entry] run-worker started; polling for queued runs');
}

void main();
