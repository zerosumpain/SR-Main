import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateSession } from '$lib/auth';
import { getTavilyKey } from '$lib/deepdive/keys';

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
    const apiKey = getTavilyKey();

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: 'test connection',
        max_results: 1,
        search_depth: 'basic',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return json({ success: false, error: `HTTP ${res.status}: ${text}` });
    }

    const data = await res.json();
    return json({ success: true, resultCount: data.results?.length ?? 0 });
  } catch (err: any) {
    return json({ success: false, error: err.message ?? 'Connection failed' });
  }
};
