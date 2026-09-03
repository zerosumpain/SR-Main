import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { readLimitedJson } from '$lib/server/service-auth';
import { webframeConfig, webframeHeaders, webframeSessionId } from '$lib/server/webframe-client';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = await readLimitedJson<Record<string, unknown>>(request, 16_384);
  const svc = webframeConfig();
  if (typeof body.session !== 'string' || !body.session) throw error(400, 'session required');
  body.session = webframeSessionId(body.session, svc.token);

  const res = await fetch(`${svc.url}/event`, {
    method: 'POST',
    headers: webframeHeaders(svc.token, true),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw error(res.status, await res.text().catch(() => 'event failed'));
  const data = await res.json().catch(() => ({}));
  return json(data);
};
