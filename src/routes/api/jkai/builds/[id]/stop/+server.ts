import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { orchestrator } from '$lib/jkai/orchestrator';

export const POST: RequestHandler = async ({ params }) => {
  try {
    await orchestrator.stopBuild(params.id);
    return json({ ok: true });
  } catch (err: any) {
    return json({ error: err.message }, { status: 400 });
  }
};
