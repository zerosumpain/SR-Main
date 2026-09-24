import type { PageServerLoad } from './$types';
import { getEntityDetail } from '$lib/jkai/intel/queries';
import { error } from '@sveltejs/kit';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

// An entity outside the scope is the same 404 as a missing one.
export const load: PageServerLoad = async (event) => {
  const detail = await getEntityDetail(event.params.id, await resolveRequestScope(event));
  if (!detail) throw error(404, 'Entity not found');
  return detail;
};
