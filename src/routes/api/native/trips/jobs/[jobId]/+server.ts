import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { nativeTripCaller, NOT_FAMILY_TRIPS } from '$lib/trips/family.server';
import { jobResponse } from '$lib/trips/jobs.server';

/**
 * GET /api/native/trips/jobs/:jobId — v6: a model-backed call started with
 * `"async": true`. `200 { job: { id, kind, status, startedAt, finishedAt,
 * result, error } }`; 404 for anyone but the caller who started it, and for
 * an id this process no longer holds (30 min after it finished, or a restart).
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await nativeTripCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY_TRIPS }, { status: 403 });
  return jobResponse(caller.email, event.params.jobId);
});
