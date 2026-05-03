import { json, error } from '@sveltejs/kit';
import { builderClient } from '$lib/jkai/builder-client';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
  try {
    await builderClient.restartBuild(params.id!);
    return json({ ok: true });
  } catch (e: any) {
    if (e?.status) throw e;
    throw error(400, e?.message ?? 'restart failed');
  }
};
