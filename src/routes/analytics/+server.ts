import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { isOwnerEmail } from '$lib/server/access';
import { plainPage } from '$lib/server/oidc/http';
import { issueTicket, safeDashboardPath } from '$lib/server/analytics-gate';

/**
 * The way into the Umami dashboard: sign in to the site, land here, and be
 * handed across ($lib/server/analytics-gate). NOT a hook bypass: the page gate
 * sends a visitor with no session to /login?callbackUrl=/analytics… and a
 * signed-in non-owner away, and this re-checks the owner anyway.
 *
 * `?to=` is where in the dashboard to land; the gate's check endpoint sets it
 * when it bounces a dashboard URL opened without a pass.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  const dashboard = (env.ANALYTICS_DASHBOARD_URL || 'https://analytics.strangeramblings.com').replace(/\/$/, '');
  const session = await locals.auth();
  const email = session?.user?.email ?? '';
  if (!email) throw redirect(302, `/login?callbackUrl=${encodeURIComponent(url.pathname + url.search)}`);
  if (!isOwnerEmail(email)) return plainPage(403, 'Not available', 'The analytics dashboard is only for the owner.');
  if (!env.AUTH_SECRET) return plainPage(503, 'Analytics unavailable', 'AUTH_SECRET is not set on this host.');

  const home = env.UMAMI_WEBSITE_ID ? `/websites/${env.UMAMI_WEBSITE_ID}` : '/dashboard';
  const to = safeDashboardPath(url.searchParams.get('to'), home);
  const ticket = issueTicket(env.AUTH_SECRET);
  throw redirect(302, `${dashboard}/__sr/enter?ticket=${encodeURIComponent(ticket)}&to=${encodeURIComponent(to)}`);
};
