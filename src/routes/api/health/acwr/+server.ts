import { json } from '@sveltejs/kit';
import { getACWR } from '$lib/health/services/acwr-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getACWR());
  } catch (err) {
    console.error('Failed to compute ACWR:', err);
    return json({ error: 'Failed to compute ACWR' }, { status: 500 });
  }
};
