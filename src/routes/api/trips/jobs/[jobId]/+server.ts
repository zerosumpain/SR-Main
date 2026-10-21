import type { RequestHandler } from './$types';
import { requireTripOwner } from '$lib/trips/access.server';
import { jobCancelResponse, jobPollResponse } from '$lib/trips/jobs.server';

/**
 * GET /api/trips/jobs/:jobId — v6: the site page's poll for ideas and
 * conversation turns started with `"async": true`. Same shape as the phone's
 * GET /api/native/trips/jobs/:jobId; only the session that started it reads it.
 * v8: a job this process no longer holds is read from its stored row (a
 * restart reads as failed with "The server restarted…", never a 404).
 */
export const GET: RequestHandler = async (event) => {
  const owner = await requireTripOwner(event);
  return jobPollResponse(owner, event.params.jobId);
};

/** DELETE /api/trips/jobs/:jobId — v8: ask the job to stop → `{ job }` (status `cancelled` once the work stops). */
export const DELETE: RequestHandler = async (event) => {
  const owner = await requireTripOwner(event);
  return jobCancelResponse(owner, event.params.jobId);
};
