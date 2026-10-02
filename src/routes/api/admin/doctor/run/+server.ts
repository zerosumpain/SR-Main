import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requestDoctorRun } from '$lib/workflows-client/doctor-client';

// Owner-only (enforced in hooks.server.ts for /api/admin/*). "Run now" for the
// workflow doctor, which SR-Workflows owns since 2026-10-02: this queues a
// manual run on its worker and relays the answer. A manual run bypasses the
// nightly window and idle gate but keeps every budget, work and write cap,
// including the switches. 409 if a run is live or already queued. Never
// retried: a lost answer may have queued the run, and the page shows it.
export const POST: RequestHandler = async () => {
  try {
    const { status, body } = await requestDoctorRun();
    return json(body, { status });
  } catch (err) {
    console.error('[workflowdoctor] run request failed:', err instanceof Error ? err.message : err);
    return json({ error: 'The workflow doctor could not be reached.' }, { status: 502 });
  }
};
