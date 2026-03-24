import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';

export const POST: RequestHandler = async () => {
  try {
    const client = getOpenAIClient();
    const model = getModel();

    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      max_tokens: 5,
    });

    const reply = response.choices[0]?.message?.content ?? '';
    return json({ success: true, reply });
  } catch (err: any) {
    return json({ success: false, error: err.message ?? 'Connection failed' }, { status: 200 });
  }
};
