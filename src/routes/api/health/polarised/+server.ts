import { json } from '@sveltejs/kit';
import { getPolarised } from '$lib/health/services/polarised-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getPolarised());
  } catch (err) {
    console.error('Failed to compute polarised distribution:', err);
    return json({ error: 'Failed to compute polarised distribution' }, { status: 500 });
  }
};
