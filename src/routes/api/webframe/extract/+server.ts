import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { extractArticle } from '$lib/webframe/extract';
import { readLimitedJson } from '$lib/server/service-auth';
import { webframeConfig, webframeHeaders, webframeSessionId } from '$lib/server/webframe-client';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = await readLimitedJson<{
    url?: string;
    html?: string;
    session?: string;
  }>(request, 1024 * 1024);
  if (!body?.url) throw error(400, 'url required');

  let html = body.html;
  if (!html && body.session) {
    const svc = webframeConfig();
    const session = webframeSessionId(body.session, svc.token);
    const res = await fetch(`${svc.url}/html?session=${session}`, {
      headers: webframeHeaders(svc.token),
    });
    if (!res.ok) throw error(res.status, await res.text().catch(() => 'html fetch failed'));
    html = await res.text();
  }
  if (!html) throw error(400, 'html or session required');
  return json(extractArticle(html, body.url));
};
