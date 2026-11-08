import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tavilySearch } from '$lib/deepdive/tavily';

// Tests the Tavily key itself, so it asks Tavily directly rather than letting
// the search balancer pick a provider. Spends one basic credit and lands on
// /admin/ops/tavily as `admin.key-test`.
export const POST: RequestHandler = async () => {
  try {
    const data = await tavilySearch('test connection', { purpose: 'admin.key-test', maxResults: 1, searchDepth: 'basic' });
    return json({ success: true, resultCount: data.results?.length ?? 0 });
  } catch (err: any) {
    return json({ success: false, error: err.message ?? 'Connection failed' });
  }
};
