import type { PageServerLoad } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { listActivityConnections } from '$lib/activity/store/connections.server';
import { listActivityGrants } from '$lib/activity/store/grants.server';
import { publicActivityConnection, publicActivityGrant } from '$lib/activity/public.server';

export const load: PageServerLoad = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  const connections = await listActivityConnections(principal.id);
  const grants = await Promise.all(
    connections.map((connection) => listActivityGrants(principal.id, connection.id)),
  );
  return {
    connections: connections.map(publicActivityConnection),
    grants: grants.flat().map(publicActivityGrant),
  };
};
