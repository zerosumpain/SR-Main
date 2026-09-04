import { json } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { requireActivityConnection } from '$lib/activity/store/connections.server';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import { beginActivityOauthTransaction } from '$lib/activity/oauth/transactions.server';
import { buildSteamOpenIdUrl } from '$lib/activity/providers/steam/openid';
import { activityErrorResponse, activityProblem } from '$lib/activity/http.server';

export const POST: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  try {
    const connection = await requireActivityConnection(principal.id, event.params.id);
    const feature = await getActivityFeatureState();
    const provider = feature.providers.find((item) => item.id === connection.provider);
    if (!provider?.canStart) {
      return activityProblem(409, 'provider_disabled', 'This activity provider is not enabled');
    }
    if (connection.provider !== 'steam' || connection.mode !== 'openid') {
      return activityProblem(409, 'authorization_not_implemented', 'This authorization mode is not implemented yet');
    }
    if (!process.env.STEAM_WEB_API_KEY) {
      return activityProblem(503, 'provider_not_configured', 'Steam Web API key is not configured');
    }

    const baseUrl = (publicEnv.PUBLIC_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
    const transaction = await beginActivityOauthTransaction({
      principalId: principal.id,
      connectionId: connection.id,
      provider: connection.provider,
      redirectPath: `/jkai/sources/connections/${connection.id}`,
      scopes: [],
    });
    const callback = new URL('/api/activity/v1/providers/steam/callback', baseUrl);
    callback.searchParams.set('connection', connection.id);
    callback.searchParams.set('state', transaction.state);
    const authorizationUrl = buildSteamOpenIdUrl({ returnTo: callback.toString(), realm: baseUrl });
    return json({ authorizationUrl, expiresAt: transaction.expiresAt });
  } catch (error) {
    return activityErrorResponse(error);
  }
};
