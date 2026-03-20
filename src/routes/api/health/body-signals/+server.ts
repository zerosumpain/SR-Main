import { json } from '@sveltejs/kit';
import { getBodySignals } from '$lib/health/body-signals-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    const result = await getBodySignals();
    return json(result);
  } catch (e) {
    console.error('body-signals error:', e);
    return json({ error: 'Internal error' }, { status: 500 });
  }
};
