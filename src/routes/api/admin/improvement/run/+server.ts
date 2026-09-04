import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runImprovementNow, getImprovementStatus } from '$lib/selfimprove/run';
import { liveBuildLanes } from '$lib/heartbeat/build-lanes';

// Owner-only (enforced in hooks.server.ts for /api/admin/*). "Run now" kicks off
// a manual improvement run that DELIBERATELY bypasses the nightly idle gate but
// keeps all budget/wall-clock caps.

/**
 * POST — start a manual run. The pipeline can take up to 25 minutes, so this
 * fires-and-forgets: `runImprovementNow` acquires its overlap lock and assigns
 * `lastRunId` synchronously (before its first await), then runs in the
 * background; the admin page polls /runs for progress. 409 if one is already
 * in progress.
 */
export const POST: RequestHandler = async () => {
  if (getImprovementStatus().running) {
    return json({ error: 'A self-improvement run is already in progress.' }, { status: 409 });
  }

  // Not awaited — the run continues in-process on the long-lived Node server.
  // The .catch keeps the (already fully self-contained) engine from surfacing an
  // unhandled rejection here.
  // Same lanes the nightly run gets. A "Run now" that behaved differently from
  // the scheduled run would make the dashboard a poor place to test anything —
  // and the tap gate still stands inside the propose phase, so this cannot
  // dispatch a build the owner has not accepted unless `autobuild` is on.
  const promise = runImprovementNow({ trigger: 'manual', lanes: liveBuildLanes() });
  promise.catch((err) => console.error('[improvement] manual run error:', err));

  // The sync prelude (lock + runId) has already landed by the time control
  // returns here, but yield one microtask to be safe before reading status.
  await Promise.resolve();
  const status = getImprovementStatus();
  if (!status.running) {
    return json({ error: 'Could not start a run — another may have just started.' }, { status: 409 });
  }
  return json({ ok: true, runId: status.lastRunId });
};
