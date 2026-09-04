import type { PageServerLoad } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import { listActivityConnections } from '$lib/activity/store/connections.server';
import { publicActivityConnection } from '$lib/activity/public.server';
import {
  getLatestActivityOnboardingSession,
  publicActivityOnboardingSession,
} from '$lib/activity/store/onboarding.server';

export const load: PageServerLoad = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  const [feature, connections, onboarding] = await Promise.all([
    getActivityFeatureState(),
    listActivityConnections(principal.id),
    getLatestActivityOnboardingSession(principal.id),
  ]);
  return {
    ...feature,
    connections: connections.map(publicActivityConnection),
    onboarding: onboarding ? publicActivityOnboardingSession(onboarding) : null,
  };
};
