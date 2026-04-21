import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = await request.json().catch(() => ({}));
  const svc = env.WEBFRAME_SERVICE_URL;
  if (!svc) throw error(503, 'webframe service not configured');

  const res = await fetch(`${svc}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw error(res.status, await res.text().catch(() => 'event failed'));
  const data = await res.json().catch(() => ({}));
  return json(data);
};
