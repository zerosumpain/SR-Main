import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateSession } from '$lib/auth';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';

function authorize(request: Request, url: URL): boolean {
  const token = url.searchParams.get('token');
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .find((c) => c.trim().startsWith('admin_session='))
    ?.split('=')[1];
  return validateSession(cookie) || validateSession(token ?? undefined);
}

export const POST: RequestHandler = async ({ request, url }) => {
  if (!authorize(request, url)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

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
