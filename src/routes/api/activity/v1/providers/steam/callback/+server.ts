import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import {
  activateActivityConnection,
  requireActivityConnection,
} from '$lib/activity/store/connections.server';
import { verifySteamOpenIdResponse } from '$lib/activity/providers/steam/openid';
import { consumeActivityOauthTransaction } from '$lib/activity/oauth/transactions.server';
import { enqueueActivityJob } from '$lib/activity/sync/queue.server';
import { hashOauthState } from '$lib/activity/oauth/pkce';

export const GET: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  const connectionId = event.url.searchParams.get('connection') ?? '';
  const state = event.url.searchParams.get('state') ?? '';
  if (!connectionId || !state) throw error(400, 'Steam callback is missing connection state');
  const connection = await requireActivityConnection(principal.id, connectionId);
  if (connection.provider !== 'steam') throw error(400, 'Connection is not a Steam connection');

  const transaction = await consumeActivityOauthTransaction({
    state,
    principalId: principal.id,
    connectionId,
    provider: 'steam',
  });
  let steamId: string;
  try {
    steamId = await verifySteamOpenIdResponse(event.url);
  } catch {
    throw redirect(303, `${transaction.redirectPath}?onboarding=1&auth=failed`);
  }
  await activateActivityConnection({
    principalId: principal.id,
    connectionId,
    provider: 'steam',
    providerAccountId: steamId,
  });
  await enqueueActivityJob({
    principalId: principal.id,
    connectionId,
    provider: 'steam',
    kind: 'initial_sync',
    idempotencyKey: `steam-openid:${hashOauthState(state)}`,
  });
  throw redirect(303, `${transaction.redirectPath}?onboarding=1&auth=connected`);
};
