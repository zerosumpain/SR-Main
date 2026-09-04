import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { requireActivityConnection } from '$lib/activity/store/connections.server';
import { listActivityGrants } from '$lib/activity/store/grants.server';
import { listActivityJobs } from '$lib/activity/sync/queue.server';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import { listActivityImports } from '$lib/activity/imports/store.server';
import { listActivityEvents } from '$lib/activity/store/events.server';
import {
  publicActivityConnection,
  publicActivityGrant,
  publicActivityImport,
  publicActivityJob,
} from '$lib/activity/public.server';

export const load: PageServerLoad = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  const connection = await requireActivityConnection(principal.id, event.params.id);
  const [grants, jobs, imports, feature, previewEvents] = await Promise.all([
    listActivityGrants(principal.id, connection.id),
    listActivityJobs(principal.id, connection.id),
    listActivityImports(principal.id, connection.id),
    getActivityFeatureState(),
    listActivityEvents(principal.id, { connectionIds: [connection.id], limit: 5 }),
  ]);
  const provider = feature.providers.find((item) => item.id === connection.provider);
  if (!provider) throw error(500, 'Provider manifest is missing');
  return {
    connection: publicActivityConnection(connection),
    provider,
    grants: grants.map(publicActivityGrant),
    jobs: jobs.map(publicActivityJob),
    imports: imports.map(publicActivityImport),
    previewEvents: previewEvents.map((activityEvent) => ({
      id: activityEvent.id,
      type: activityEvent.type,
      category: activityEvent.category,
      occurredAt: activityEvent.occurredAt,
      observedAt: activityEvent.observedAt,
      evidenceMode: activityEvent.evidenceMode,
      object: {
        kind: activityEvent.object.kind,
        label: activityEvent.object.label,
        url: activityEvent.object.url,
      },
    })),
    authResult: ['connected', 'failed'].includes(event.url.searchParams.get('auth') ?? '')
      ? event.url.searchParams.get('auth') as 'connected' | 'failed'
      : null,
    fabricEnabled: feature.enabled,
  };
};
