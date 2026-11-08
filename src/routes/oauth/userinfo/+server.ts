import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyAccessToken } from '$lib/server/oidc/provider';
import { notFound, oidcConfig } from '$lib/server/oidc/http';

/**
 * The signed-in owner's claims, for a Bearer access token from /oauth/token.
 * An exact hook bypass: the token is the credential (HMAC, five minutes).
 */
const handle: RequestHandler = ({ request }) => {
  const config = oidcConfig();
  if (!config) return notFound();
  const header = request.headers.get('authorization') ?? '';
  const token = /^bearer /i.test(header) ? header.slice(7).trim() : '';
  const claims = verifyAccessToken(config, token);
  if (!claims) {
    return new Response(JSON.stringify({ error: 'invalid_token' }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'www-authenticate': 'Bearer error="invalid_token"' },
    });
  }
  return json(
    { sub: claims.sub, email: claims.email, email_verified: true, name: claims.name },
    { headers: { 'cache-control': 'no-store' } },
  );
};

export const GET = handle;
export const POST = handle;
