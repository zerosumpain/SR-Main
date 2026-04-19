import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIntelStats } from '$lib/jkai/intel/queries';

export const GET: RequestHandler = async () => {
  const stats = await getIntelStats();
  return json(stats);
};
