import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { readLimitedJson } from '$lib/server/service-auth';
import { webframeConfig, webframeHeaders, webframeSessionId } from '$lib/server/webframe-client';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = await readLimitedJson<Record<string, unknown>>(request, 4_096);
  const svc = webframeConfig();
  if (typeof body.session !== 'string' || !body.session) throw error(400, 'session required');
  body.session = webframeSessionId(body.session, svc.token);
  try {
    await fetch(`${svc.url}/close`, {
      method: 'POST',
      headers: webframeHeaders(svc.token, true),
      body: JSON.stringify(body),
    });
  } catch {}
  return json({ ok: true });
};
