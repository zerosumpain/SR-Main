import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { nativeTripCaller, NOT_FAMILY_TRIPS } from '$lib/trips/family.server';
import { jobCancelResponse, jobPollResponse } from '$lib/trips/jobs.server';

/**
 * GET /api/native/trips/jobs/:jobId — v6: a model-backed call started with
 * `"async": true`. `200 { job: { id, kind, status, tripId, stages, startedAt,
 * finishedAt, result, error } }`; 404 for anyone but the caller who started
 * it. v8: durable — a job this process no longer holds is read from its
 * stored row; one a previous process was running reads as failed ("The
 * server restarted before that finished — try again."), keeping a made trip's id.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await nativeTripCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY_TRIPS }, { status: 403 });
  return jobPollResponse(caller.email, event.params.jobId);
});

/**
 * DELETE /api/native/trips/jobs/:jobId — v8: Cancel that really cancels. The
 * work stops between its stages; `200 { job }` (status `cancelled` once it
 * has); 404 for anyone but the caller who started it.
 */
export const DELETE: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await nativeTripCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY_TRIPS }, { status: 403 });
  return jobCancelResponse(caller.email, event.params.jobId);
});
