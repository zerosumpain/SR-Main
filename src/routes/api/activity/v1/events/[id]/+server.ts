import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { activityProblem } from '$lib/activity/http.server';
import { getActivityEvent } from '$lib/activity/store/events.server';

export const GET: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  const activityEvent = await getActivityEvent(principal.id, event.params.id);
  if (!activityEvent) return activityProblem(404, 'event_not_found', 'Activity event not found');
  return json({ event: activityEvent });
};
