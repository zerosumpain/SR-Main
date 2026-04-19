import type { PageServerLoad } from './$types';
import { getNoteDetail } from '$lib/jkai/intel/queries';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const detail = await getNoteDetail(params.id);
  if (!detail) throw error(404, 'Note not found');
  return detail;
};
