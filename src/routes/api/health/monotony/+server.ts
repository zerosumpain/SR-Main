import { json } from '@sveltejs/kit';
import { getMonotony } from '$lib/health/services/monotony-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getMonotony());
  } catch (err) {
    console.error('Failed to compute monotony:', err);
    return json({ error: 'Failed to compute monotony' }, { status: 500 });
  }
};
