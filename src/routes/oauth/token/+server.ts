import type { RequestHandler } from './$types';
import {
  ACCESS_TOKEN_TTL_S,
  authenticateClient,
  issueAccessToken,
  issueIdToken,
  openCode,
  spendCode,
  subjectFor,
  verifyPkce,
} from '$lib/server/oidc/provider';
import { notFound, oauthError, oidcConfig } from '$lib/server/oidc/http';

/**
 * Code → tokens, called server to server by the client app (Immich's server,
 * with openid-client). An exact hook bypass: the client authenticates itself
 * with its secret (basic or post), and the code carries everything else.
 *
 * SvelteKit's CSRF check would 403 this form POST, which arrives with no Origin
 * (or a foreign one), before any hook runs. scripts/server-with-ws.mjs stamps
 * the site's own origin on exactly POST /oauth/token and strips its cookies;
 * nothing here reads a cookie, so there is no ambient credential to forge.
 */
export const POST: RequestHandler = async ({ request, url }) => {
  const config = oidcConfig();
  if (!config) return notFound();

  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return oauthError(400, 'invalid_request', 'Expected application/x-www-form-urlencoded.');
  }
  const form = new URLSearchParams(await request.text());

  const auth = authenticateClient(config, request.headers.get('authorization'), form);
  if (!auth.ok) {
    return auth.error === 'invalid_client'
      ? oauthError(401, 'invalid_client', 'Client authentication failed.', auth.basic ? { 'www-authenticate': 'Basic realm="oauth"' } : {})
      : oauthError(400, 'invalid_request', 'Use one client authentication method.');
  }
  const { client } = auth;

  if (form.get('grant_type') !== 'authorization_code') return oauthError(400, 'unsupported_grant_type');

  const code = openCode(config, form.get('code') ?? '');
  // One answer for every way a code can be wrong, so a probe learns nothing.
  const bad = () => oauthError(400, 'invalid_grant', 'The code is invalid, expired or already used.');
  if (!code || code.clientId !== client.id) return bad();
  if (form.get('redirect_uri') !== code.redirectUri) return bad();
  if (!verifyPkce(form.get('code_verifier'), code.codeChallenge)) return bad();
  if (!spendCode(code.jti, code.exp)) return bad();

  const now = Math.floor(Date.now() / 1000);
  const sub = subjectFor(code.email);
  const accessToken = issueAccessToken(config, {
    sub,
    email: code.email,
    name: code.name,
    aud: client.id,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_S,
  });
  const idToken = issueIdToken(client, { iss: url.origin, sub, email: code.email, name: code.name, nonce: code.nonce }, now);
  console.log(`[oidc] tokens issued to ${client.id}`);

  return new Response(
    JSON.stringify({ access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_S, id_token: idToken, scope: 'openid email profile' }),
    { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', pragma: 'no-cache' } },
  );
};
