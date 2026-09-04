import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { activityErrorResponse } from '$lib/activity/http.server';
import { confirmActivityImport } from '$lib/activity/imports/store.server';

export const POST: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  try {
    const job = await confirmActivityImport(principal.id, event.params.id);
    return json({ accepted: true, jobId: job.jobId, duplicate: !job.inserted }, { status: 202 });
  } catch (error) {
    return activityErrorResponse(error);
  }
};
