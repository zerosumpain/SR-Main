import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/public';
import { projectTrackerScript } from '$lib/analytics/project-tracker';

/**
 * The tracker the SR-Infra gateway injects into project applications' pages
 * ($lib/analytics/project-tracker). Public, like Umami's own script: it holds
 * the site id and nothing else of this host's. Empty (and harmless) while
 * Umami is not configured here.
 */
export const GET: RequestHandler = () => {
  const siteId = env.PUBLIC_UMAMI_SITE_ID ?? '';
  const scriptUrl = env.PUBLIC_UMAMI_SCRIPT_URL ?? '';
  const domains = env.PUBLIC_UMAMI_DOMAINS || 'strangeramblings.com,www.strangeramblings.com';
  const body = siteId && scriptUrl ? projectTrackerScript({ siteId, scriptUrl, domains }) : '/* analytics not configured */\n';
  return new Response(body, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
};
