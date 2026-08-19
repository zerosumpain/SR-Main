import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSegment } from '$lib/trails/segments-service';

export const load: PageServerLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw error(404, 'Segment not found');

  const segment = await getSegment(id);
  if (!segment) throw error(404, 'Segment not found');
  return { segment };
};
