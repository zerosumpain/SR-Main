import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { builderClient } from '$lib/jkai/builder-client';

export const POST: RequestHandler = async ({ params }) => {
  try {
    await builderClient.cancelQueued(params.id);
    return json({ ok: true });
  } catch (err: any) {
    return json({ error: err.message }, { status: 400 });
  }
};
