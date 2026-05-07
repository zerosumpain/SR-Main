import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import { getIntegrationAdapter } from '$lib/integrations';
import { pendingState, pruneExpired } from '$lib/integrations/oauth-pending-state';
import { env as publicEnv } from '$env/dynamic/public';

export const POST: RequestHandler = async ({ params, request }) => {
  pruneExpired();
  const integrationType = params.integrationType;
  const adapter = getIntegrationAdapter(integrationType);
  if (!adapter) throw error(404, `Unknown integrationType: ${integrationType}`);
  if (!adapter.oauthSpec) throw error(400, `${integrationType} does not use OAuth`);

  const body = (await request.json().catch(() => ({}))) as {
    label?: string;
    scopes?: string[];
  };
  const label = body.label ?? `${integrationType} ${new Date().toISOString().slice(0, 10)}`;
  const scopes = body.scopes ?? adapter.oauthSpec.defaultScopes;
  const clientId = process.env[adapter.oauthSpec.clientIdEnvVar];
  if (!clientId) throw error(500, `Missing env var ${adapter.oauthSpec.clientIdEnvVar}`);

  const state = randomBytes(16).toString('hex');
  pendingState.set(state, { integrationType, label, scopes, createdAt: Date.now() });

  const baseUrl = publicEnv.PUBLIC_BASE_URL || 'http://localhost:5173';
  const callback = adapter.oauthSpec.extraAuthParams?.()['redirect_uri']
    ?? `${baseUrl}/api/integrations/oauth/${integrationType}/callback`;

  const url = new URL(adapter.oauthSpec.authorizationUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callback);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (scopes.length > 0) url.searchParams.set('scope', scopes.join(' '));
  if (adapter.oauthSpec.extraAuthParams) {
    for (const [k, v] of Object.entries(adapter.oauthSpec.extraAuthParams())) {
      if (k !== 'redirect_uri') url.searchParams.set(k, v);
    }
  }
  return json({ authorizationUrl: url.toString(), state });
};
