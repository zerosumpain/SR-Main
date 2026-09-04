import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';

export const GET: RequestHandler = async (event) => {
  await requireOwnerActivityPrincipal(event);
  return json(await getActivityFeatureState());
};
