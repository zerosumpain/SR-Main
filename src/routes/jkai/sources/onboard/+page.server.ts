import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import {
  getActivityOnboardingSession,
  getLatestActivityOnboardingSession,
  publicActivityOnboardingSession,
} from '$lib/activity/store/onboarding.server';

export const load: PageServerLoad = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  const feature = await getActivityFeatureState();
  const requestedProvider = event.url.searchParams.get('provider');
  if (
    requestedProvider &&
    !feature.providers.some((provider) => provider.id === requestedProvider)
  ) {
    throw error(404, 'Activity provider not found');
  }

  const sessionId = event.url.searchParams.get('session');
  const restart = event.url.searchParams.get('restart') === '1';
  const onboarding = restart
    ? null
    : sessionId
      ? await getActivityOnboardingSession(principal.id, sessionId)
      : await getLatestActivityOnboardingSession(principal.id);

  if (sessionId && !onboarding) throw error(404, 'Activity onboarding journey not found');
  if (onboarding?.connectionId) {
    redirect(
      307,
      `/jkai/sources/connections/${encodeURIComponent(onboarding.connectionId)}?journey=${encodeURIComponent(onboarding.id)}`,
    );
  }
  return {
    ...feature,
    requestedProvider,
    onboarding: onboarding ? publicActivityOnboardingSession(onboarding) : null,
  };
};
