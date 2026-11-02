import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { discoveryDocument } from '$lib/server/oidc/provider';
import { notFound, oidcConfig } from '$lib/server/oidc/http';

/**
 * OpenID discovery for Main's owner-only provider ($lib/server/oidc/provider).
 * Public (an exact hook bypass): it names endpoints and nothing else. 404 until
 * the provider is configured. The issuer is this site's own origin, the same
 * string the ID token's `iss` carries.
 */
export const GET: RequestHandler = ({ url }) => {
  if (!oidcConfig()) return notFound();
  return json(discoveryDocument(url.origin), { headers: { 'cache-control': 'public, max-age=300' } });
};
