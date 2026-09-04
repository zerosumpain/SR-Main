import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';

export const load: PageServerLoad = async (event) => {
  await requireOwnerActivityPrincipal(event);
  const feature = await getActivityFeatureState();
  const provider = feature.providers.find((item) => item.id === event.params.provider);
  if (!provider) throw error(404, 'Activity provider not found');
  redirect(307, `/jkai/sources/onboard?provider=${encodeURIComponent(provider.id)}`);
};
