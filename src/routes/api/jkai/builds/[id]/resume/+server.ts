import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { orchestrator } from '$lib/jkai/orchestrator';
import { authorize } from '../../../auth';

export const POST: RequestHandler = async ({ params, cookies, url }) => {
  if (!authorize(cookies, url)) return json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await orchestrator.resumeBuild(params.id);
    return json({ ok: true });
  } catch (err: any) {
    return json({ error: err.message }, { status: 400 });
  }
};
