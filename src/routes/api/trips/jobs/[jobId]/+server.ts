import type { RequestHandler } from './$types';
import { requireTripOwner } from '$lib/trips/access.server';
import { jobResponse } from '$lib/trips/jobs.server';

/**
 * GET /api/trips/jobs/:jobId — v6: the site page's poll for ideas and
 * conversation turns started with `"async": true`. Same shape as the phone's
 * GET /api/native/trips/jobs/:jobId; only the session that started it reads it.
 */
export const GET: RequestHandler = async (event) => {
  const owner = await requireTripOwner(event);
  return jobResponse(owner, event.params.jobId);
};
