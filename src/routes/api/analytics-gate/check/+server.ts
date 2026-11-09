import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { passCookieName, safeDashboardPath, verifyPass } from '$lib/server/analytics-gate';

/**
 * Caddy's forward_auth for the Umami dashboard: 204 with a valid pass.
 * Without one, a page navigation is sent to the site's /analytics (which asks
 * for the site login first, then hands back to the URL that was opened) and
 * anything else gets a bare 401. Hook bypass (exact path); answers nothing but
 * yes or no.
 */
export const GET: RequestHandler = async ({ cookies, request, url }) => {
  const headers = { 'cache-control': 'private, no-store' };
  if (verifyPass(cookies.get(passCookieName(import.meta.env.DEV)), env.AUTH_SECRET)) {
    return new Response(null, { status: 204, headers });
  }
  const navigation =
    request.headers.get('sec-fetch-mode') === 'navigate' ||
    (request.headers.get('accept') ?? '').includes('text/html');
  if (!navigation) return new Response(null, { status: 401, headers });
  const to = safeDashboardPath(request.headers.get('x-forwarded-uri'), '');
  const target = `${url.origin}/analytics${to ? `?to=${encodeURIComponent(to)}` : ''}`;
  return new Response(null, { status: 302, headers: { ...headers, location: target } });
};
