import { activityEventSort } from '$lib/activity/contracts/query';
import type { PageServerLoad } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { listActivityConnections } from '$lib/activity/store/connections.server';
import { listActivityEvents } from '$lib/activity/store/events.server';
import { EVIDENCE_MODES, type EvidenceMode } from '$lib/activity/contracts';

export const load: PageServerLoad = async (event) => {
  const ordering = activityEventSort(event.url.searchParams);
  const principal = await requireOwnerActivityPrincipal(event);
  const evidenceParam = event.url.searchParams.get('evidence');
  const evidence = evidenceParam && EVIDENCE_MODES.includes(evidenceParam as EvidenceMode)
    ? (evidenceParam as EvidenceMode)
    : null;
  const connection = event.url.searchParams.get('connection');
  const [events, connections] = await Promise.all([
    listActivityEvents(principal.id, {
      evidenceModes: evidence ? [evidence] : undefined,
      connectionIds: connection ? [connection] : undefined,
      limit: 100,
      ...ordering,
    }),
    listActivityConnections(principal.id),
  ]);
  return { events, connections, ordering, filters: { evidence, connection } };
};
