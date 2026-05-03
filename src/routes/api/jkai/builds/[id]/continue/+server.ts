import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { builderClient } from '$lib/jkai/builder-client';

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const body = await request.json();
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return json({ error: 'Improvement prompt is required' }, { status: 400 });
    }
    const modelOverride =
      body.modelProvider || body.modelId
        ? { provider: body.modelProvider, modelId: body.modelId }
        : undefined;
    await builderClient.continueBuild(params.id, prompt, modelOverride);
    return json({ ok: true });
  } catch (err: any) {
    return json({ error: err.message }, { status: 400 });
  }
};
