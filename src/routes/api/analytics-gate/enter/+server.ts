import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { plainPage } from '$lib/server/oidc/http';
import {
  PASS_TTL_SECONDS,
  issuePass,
  passCookieName,
  redeemTicket,
  safeDashboardPath,
  umamiUiToken,
} from '$lib/server/analytics-gate';

/**
 * Reached ONLY through Caddy on the analytics host, as `/__sr/enter`, so the
 * cookie it sets is host-only on analytics.strangeramblings.com and never
 * reaches the site or any sibling. Hook bypass (exact path): the single-use,
 * 60-second HMAC ticket minted by the owner-only /analytics IS the credential.
 *
 * The relative redirect resolves against the analytics host: Umami's own
 * /sso page stores the UI token and moves on to `to`.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
  if (!redeemTicket(url.searchParams.get('ticket'), env.AUTH_SECRET)) {
    return plainPage(403, 'Link expired', 'Open the dashboard from strangeramblings.com/analytics again.');
  }
  const baseUrl = env.UMAMI_API_BASE;
  const token =
    baseUrl && env.UMAMI_USERNAME && env.UMAMI_PASSWORD
      ? await umamiUiToken({ baseUrl, username: env.UMAMI_USERNAME, password: env.UMAMI_PASSWORD })
      : null;
  if (!token) return plainPage(503, 'Analytics unavailable', 'This site could not sign in to Umami.');

  cookies.set(passCookieName(import.meta.env.DEV), issuePass(env.AUTH_SECRET!), {
    path: '/',
    httpOnly: true,
    secure: !import.meta.env.DEV,
    sameSite: 'lax',
    maxAge: PASS_TTL_SECONDS,
  });
  const to = safeDashboardPath(url.searchParams.get('to'), '/dashboard');
  throw redirect(302, `/sso?token=${encodeURIComponent(token)}&url=${encodeURIComponent(to)}`);
};
