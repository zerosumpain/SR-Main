import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { getActivityEvent } from '$lib/activity/store/events.server';
import { requireActivityConnection } from '$lib/activity/store/connections.server';

export const load: PageServerLoad = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  const activityEvent = await getActivityEvent(principal.id, event.params.id);
  if (!activityEvent) throw error(404, 'Activity event not found');
  const connection = await requireActivityConnection(principal.id, activityEvent.connectionId);
  return { event: activityEvent, connection };
};
