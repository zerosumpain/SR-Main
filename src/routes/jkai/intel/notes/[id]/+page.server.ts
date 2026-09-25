import type { PageServerLoad } from './$types';
import { getNoteDetail } from '$lib/jkai/intel/queries';
import { error } from '@sveltejs/kit';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

// A note outside the scope is the same 404 as a missing one.
export const load: PageServerLoad = async (event) => {
  const detail = await getNoteDetail(event.params.id, await resolveRequestScope(event));
  if (!detail) throw error(404, 'Note not found');
  return detail;
};
