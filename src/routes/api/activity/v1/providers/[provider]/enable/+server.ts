import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { enableActivityProvider } from '$lib/activity/providers/flags.server';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import { activityErrorResponse, activityProblem } from '$lib/activity/http.server';

/**
 * The guided setup's "Turn on" button. Flips the provider's own flag and the
 * fabric switch in one action — the same two rows `/admin/connections/catalog`
 * edits, behind the same launch gate — so the owner is not sent to an admin
 * page in the middle of connecting a source.
 */
export const POST: RequestHandler = async (event) => {
  await requireOwnerActivityPrincipal(event);
  try {
    await enableActivityProvider(event.params.provider);
    const feature = await getActivityFeatureState();
    const provider = feature.providers.find((item) => item.id === event.params.provider);
    if (!provider) return activityProblem(404, 'provider_not_found', 'Unknown activity provider');
    return json({ enabled: feature.enabled, provider });
  } catch (error) {
    return activityErrorResponse(error);
  }
};
