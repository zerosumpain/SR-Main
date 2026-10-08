import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { search } from '$lib/deepdive/tavily';

// Spends one basic credit, so it goes through the client like every other
// caller and lands on /admin/ops/tavily as `admin.key-test`.
export const POST: RequestHandler = async () => {
  try {
    const data = await search('test connection', { purpose: 'admin.key-test', maxResults: 1, searchDepth: 'basic' });
    return json({ success: true, resultCount: data.results?.length ?? 0 });
  } catch (err: any) {
    return json({ success: false, error: err.message ?? 'Connection failed' });
  }
};
