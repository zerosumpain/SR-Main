import type { PageServerLoad } from './$types';
import { getEntityDetail } from '$lib/jkai/intel/queries';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const detail = await getEntityDetail(params.id);
  if (!detail) throw error(404, 'Entity not found');
  return detail;
};
