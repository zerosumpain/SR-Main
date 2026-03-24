import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTavilyKey } from '$lib/deepdive/keys';

export const POST: RequestHandler = async () => {
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
