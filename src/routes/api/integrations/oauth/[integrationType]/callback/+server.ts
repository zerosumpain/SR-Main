import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { getIntegrationAdapter } from '$lib/integrations';
import { createCredential } from '$lib/integrations/credentials';
import { pendingState } from '$lib/integrations/oauth-pending-state';
import { env as publicEnv } from '$env/dynamic/public';

export const GET: RequestHandler = async ({ params, url }) => {
  const integrationType = params.integrationType;
  const adapter = getIntegrationAdapter(integrationType);
  if (!adapter || !adapter.oauthSpec) throw error(404, 'Unknown integration');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) throw error(400, 'Missing code or state');

  const pending = pendingState.get(state);
  if (!pending || pending.integrationType !== integrationType) {
    throw error(400, 'Unknown or mismatched state');
  }
  pendingState.delete(state);

  const clientId = process.env[adapter.oauthSpec.clientIdEnvVar];
  const clientSecret = process.env[adapter.oauthSpec.clientSecretEnvVar];
  if (!clientId || !clientSecret) {
    throw error(500, `Missing OAuth client credentials for ${integrationType}`);
  }

  const baseUrl = publicEnv.PUBLIC_BASE_URL || 'http://localhost:5173';
  const callbackUrl = `${baseUrl}/api/integrations/oauth/${integrationType}/callback`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: callbackUrl,
  });

  const res = await fetch(adapter.oauthSpec.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw error(502, `Token exchange failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  const id = await createCredential({
    integrationType,
    label: pending.label,
    kind: 'oauth2',
    payload: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + Number(json.expires_in) * 1000,
      scopes: pending.scopes,
    },
  });

  throw redirect(303, `/admin/connections/credentials?credential=${id}`);
};
