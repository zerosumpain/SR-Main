import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getRoute } from '$lib/trails/routes-service';

export const load: PageServerLoad = async ({ params }) => {
  const route = await getRoute(params.id);
  if (!route) throw error(404, 'Route not found');
  return { route };
};
