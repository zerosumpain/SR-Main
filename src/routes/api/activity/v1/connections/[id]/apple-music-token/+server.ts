import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import {
  bindActivityTokenCredential,
  requireActivityConnection,
} from '$lib/activity/store/connections.server';
import {
  ActivityRequestError,
  activityErrorResponse,
  activityProblem,
  readActivityJson,
} from '$lib/activity/http.server';
import { enqueueActivityJob } from '$lib/activity/sync/queue.server';
import { stableActivityId } from '$lib/activity/store/ids';

export const POST: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  try {
    const feature = await getActivityFeatureState();
    const provider = feature.providers.find((item) => item.id === 'apple_music');
    if (!provider?.canStart) {
      return activityProblem(409, 'provider_disabled', 'Apple Music is not enabled');
    }
    const connection = await requireActivityConnection(principal.id, event.params.id);
    if (connection.provider !== 'apple_music') {
      return activityProblem(409, 'provider_mismatch', 'Connection is not an Apple Music connection');
    }
    const body = await readActivityJson(event.request);
    const token = typeof body.musicUserToken === 'string' ? body.musicUserToken.trim() : '';
    if (token.length < 20 || token.length > 16_384) {
      throw new ActivityRequestError('invalid_music_user_token', 'Apple Music returned an invalid user token');
    }
    await bindActivityTokenCredential({
      principalId: principal.id,
      connectionId: connection.id,
      provider: 'apple_music',
      providerAccountId: 'apple-music-user',
      token,
      label: `${connection.label} Music User Token`,
    });
    const tokenFingerprint = stableActivityId('atok', [token]);
    const job = await enqueueActivityJob({
      principalId: principal.id,
      connectionId: connection.id,
      provider: 'apple_music',
      kind: 'initial_sync',
      idempotencyKey: `apple-music-authorize:${tokenFingerprint}`,
    });
    return json({ connected: true, jobId: job.id });
  } catch (error) {
    return activityErrorResponse(error);
  }
};
