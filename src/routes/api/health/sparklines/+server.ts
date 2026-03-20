import { json } from '@sveltejs/kit';
import { getSparklines } from '$lib/health/sparkline-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    const result = await getSparklines();
    return json(result);
  } catch (e) {
    console.error('sparklines error:', e);
    return json({ error: 'Internal error' }, { status: 500 });
  }
};
