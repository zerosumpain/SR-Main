import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { notFound, oidcConfig } from '$lib/server/oidc/http';

/**
 * No public keys: ID tokens are HS256, keyed with the client's own secret
 * (OIDC Core 10.1). The endpoint exists because discovery must name one.
 */
export const GET: RequestHandler = () => {
  if (!oidcConfig()) return notFound();
  return json({ keys: [] }, { headers: { 'cache-control': 'public, max-age=300' } });
};
