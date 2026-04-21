import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { extractArticle } from '$lib/webframe/extract';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    html?: string;
    session?: string;
  };
  if (!body?.url) throw error(400, 'url required');

  let html = body.html;
  if (!html && body.session) {
    const svc = env.WEBFRAME_SERVICE_URL;
    if (!svc) throw error(503, 'webframe service not configured');
    const res = await fetch(`${svc}/html?session=${encodeURIComponent(body.session)}`);
    if (!res.ok) throw error(res.status, await res.text().catch(() => 'html fetch failed'));
    html = await res.text();
  }
  if (!html) throw error(400, 'html or session required');
  return json(extractArticle(html, body.url));
};
