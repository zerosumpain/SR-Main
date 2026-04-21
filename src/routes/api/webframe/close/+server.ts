import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = await request.json().catch(() => ({}));
  const svc = env.WEBFRAME_SERVICE_URL;
  if (!svc) return json({ ok: true }); // nothing to close
  try {
    await fetch(`${svc}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {}
  return json({ ok: true });
};
