import { json } from '@sveltejs/kit';
import { getStats } from '$lib/health/stats-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    const result = await getStats();
    return json(result);
  } catch (e) {
    console.error('stats error:', e);
    return json({ error: 'Internal error' }, { status: 500 });
  }
};
