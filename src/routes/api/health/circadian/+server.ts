import { json } from '@sveltejs/kit';
import { getCircadianAlignment } from '$lib/health/services/circadian-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getCircadianAlignment());
  } catch (err) {
    console.error('Failed to compute circadian alignment:', err);
    return json({ error: 'Failed to compute circadian alignment' }, { status: 500 });
  }
};
