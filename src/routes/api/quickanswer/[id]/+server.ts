import type { RequestHandler } from './$types';
import { requestStop } from '$lib/quickanswer/worker';
import { json } from '@sveltejs/kit';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  if (body.action === 'stop') {
    requestStop(params.id);
    return json({ ok: true });
  }
  return json({ error: 'Unknown action' }, { status: 400 });
};
