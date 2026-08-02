import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDoctorStatus, runDoctorNow } from '$lib/workflowdoctor/run';

// Owner-only (enforced in hooks.server.ts for /api/admin/*). "Run now" kicks off
// a manual doctor run that DELIBERATELY bypasses the nightly idle gate but keeps
// every budget, work and write cap — including the two switches, so a manual run
// is no more privileged than the 05:00 one.

/**
 * POST — start a manual run. The pipeline can take up to 20 minutes, so this
 * fires-and-forgets: `runDoctorNow` takes its overlap lock and assigns
 * `lastRunId` synchronously (before its first await), then runs in the
 * background; the admin page re-loads for progress. 409 if one is already in
 * flight — starting a second would race the first on the same canvases.
 */
export const POST: RequestHandler = async () => {
  if (getDoctorStatus().running) {
    return json({ error: 'A workflow doctor run is already in progress.' }, { status: 409 });
  }

  // Not awaited — the run continues in-process on the long-lived Node server.
  // The .catch keeps the (already fully self-contained) pipeline from surfacing
  // an unhandled rejection here; the only rejection it has is the overlap guard.
  const promise = runDoctorNow({ trigger: 'manual' });
  promise.catch((err) => console.error('[workflowdoctor] manual run error:', err));

  // The sync prelude (lock + runId) has already landed by the time control
  // returns here, but yield one microtask to be safe before reading status.
  await Promise.resolve();
  const status = getDoctorStatus();
  if (!status.running) {
    return json({ error: 'Could not start a run — another may have just started.' }, { status: 409 });
  }
  return json({ ok: true, runId: status.lastRunId });
};
