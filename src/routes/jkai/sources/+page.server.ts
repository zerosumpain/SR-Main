import type { PageServerLoad } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import { listActivityConnections } from '$lib/activity/store/connections.server';
import { publicActivityConnection } from '$lib/activity/public.server';

export const load: PageServerLoad = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  const [feature, connections] = await Promise.all([
    getActivityFeatureState(),
    listActivityConnections(principal.id),
  ]);
  return { ...feature, connections: connections.map(publicActivityConnection) };
};
