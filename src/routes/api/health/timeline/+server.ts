import { json } from '@sveltejs/kit';
import { getTimeline } from '$lib/health/timeline-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const page = parseInt(url.searchParams.get('page') ?? '1', 10);
    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
    const result = await getTimeline(page, limit);
    return json(result);
  } catch (e) {
    console.error('timeline error:', e);
    return json({ error: 'Internal error' }, { status: 500 });
  }
};
