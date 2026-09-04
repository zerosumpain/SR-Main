import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { activityProblem } from '$lib/activity/http.server';
import { getActivityImport } from '$lib/activity/imports/store.server';
import { publicActivityImport } from '$lib/activity/public.server';

export const GET: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  const activityImport = await getActivityImport(principal.id, event.params.id);
  if (!activityImport) return activityProblem(404, 'import_not_found', 'Activity import not found');
  return json({ import: publicActivityImport(activityImport) });
};
