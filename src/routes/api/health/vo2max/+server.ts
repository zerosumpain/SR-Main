import { json } from '@sveltejs/kit';
import { getVO2Max } from '$lib/health/services/vo2max-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getVO2Max());
  } catch (err) {
    console.error('Failed to compute VO2max:', err);
    return json({ error: 'Failed to compute VO2max' }, { status: 500 });
  }
};
