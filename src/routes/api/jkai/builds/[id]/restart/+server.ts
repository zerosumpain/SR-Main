import { json, error } from '@sveltejs/kit';
import { orchestrator } from '$lib/jkai/orchestrator';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
  try {
    await orchestrator.restartBuild(params.id!);
    return json({ ok: true });
  } catch (e: any) {
    if (e?.status) throw e;
    throw error(400, e?.message ?? 'restart failed');
  }
};
