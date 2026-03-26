import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { orchestrator } from '$lib/jkai/orchestrator';

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const body = await request.json();
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return json({ error: 'Improvement prompt is required' }, { status: 400 });
    }
    await orchestrator.continueBuild(params.id, prompt);
    return json({ ok: true });
  } catch (err: any) {
    return json({ error: err.message }, { status: 400 });
  }
};
