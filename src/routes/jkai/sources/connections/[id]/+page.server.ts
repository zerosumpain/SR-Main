import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { requireActivityConnection } from '$lib/activity/store/connections.server';
import { listActivityGrants } from '$lib/activity/store/grants.server';
import { listActivityJobs } from '$lib/activity/sync/queue.server';
import { getActivityFeatureState, type PublicActivityProvider } from '$lib/activity/providers/catalog.server';
import { getCatalogProvider } from '$lib/activity/providers/catalog';
import { listActivityImports } from '$lib/activity/imports/store.server';
import { listActivityEvents } from '$lib/activity/store/events.server';
import {
  publicActivityConnection,
  publicActivityGrant,
  publicActivityImport,
  publicActivityJob,
} from '$lib/activity/public.server';
import {
  getActivityOnboardingSession,
  publicActivityOnboardingSession,
} from '$lib/activity/store/onboarding.server';

export const load: PageServerLoad = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  const connection = await requireActivityConnection(principal.id, event.params.id);
  const journeyId = event.url.searchParams.get('journey');
  const [grants, jobs, imports, feature, previewEvents, onboarding] = await Promise.all([
    listActivityGrants(principal.id, connection.id),
    listActivityJobs(principal.id, connection.id),
    listActivityImports(principal.id, connection.id),
    getActivityFeatureState(),
    listActivityEvents(principal.id, { connectionIds: [connection.id], limit: 5 }),
    journeyId ? getActivityOnboardingSession(principal.id, journeyId) : Promise.resolve(null),
  ]);
  // A connection outlives its catalogue entry: the local fixture is hidden
  // from the public list, and a provider can be withdrawn after connecting.
  // The page must still render so the connection can be inspected and erased.
  const provider: PublicActivityProvider | undefined =
    feature.providers.find((item) => item.id === connection.provider) ??
    withdrawnProvider(connection.provider);
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
    /** A one-line reason handed over by the wizard when authorization could not begin. */
    notice: (event.url.searchParams.get('notice') ?? '').trim().slice(0, 240) || null,
    fabricEnabled: feature.enabled,
    onboardingSession:
      onboarding?.connectionId === connection.id
        ? publicActivityOnboardingSession(onboarding)
        : null,
  };
};

function withdrawnProvider(id: string): PublicActivityProvider | undefined {
  const manifest = getCatalogProvider(id)?.manifest;
  if (!manifest) return undefined;
  const { requiredSecrets: _requiredSecrets, ...rest } = manifest;
  return {
    ...rest,
    enabled: false,
    operatorConfigured: false,
    operatorSetup: [],
    startBlocker: 'not_launched',
    canStart: false,
  };
}
