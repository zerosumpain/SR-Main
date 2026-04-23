import type { RequestHandler } from '@sveltejs/kit';

/**
 * Lightweight session validity check for Caddy's forward_auth on the VNC proxy.
 * Returns 204 if a valid session exists (cookies already sent by the browser
 * to the proxy because the session cookie is domain-scoped to .strangeramblings.com),
 * 401 otherwise. No body.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const session = await locals.auth();
  if (!session?.user) {
    return new Response(null, { status: 401 });
  }
  return new Response(null, { status: 204 });
};
