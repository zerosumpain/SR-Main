import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import {
  createAppleMusicDeveloperToken,
  loadAppleMusicDeveloperTokenConfig,
} from '$lib/activity/providers/apple-music/developer-token.server';
import { activityProblem } from '$lib/activity/http.server';

export const GET: RequestHandler = async (event) => {
  await requireOwnerActivityPrincipal(event);
  const feature = await getActivityFeatureState();
  const provider = feature.providers.find((item) => item.id === 'apple_music');
  if (!provider?.canStart) {
    return activityProblem(409, 'provider_disabled', 'Apple Music is not enabled');
  }
  try {
    return json(createAppleMusicDeveloperToken(loadAppleMusicDeveloperTokenConfig()));
  } catch {
    return activityProblem(503, 'provider_not_configured', 'Apple Music developer credentials are not configured');
  }
};
