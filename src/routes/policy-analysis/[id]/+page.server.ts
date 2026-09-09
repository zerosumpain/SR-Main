import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { detail } from '$lib/policy-analysis/server/store';
export const load: PageServerLoad = async (event) => {
  const result = await detail(await requirePolicyOwner(event), event.params.id);
  if (!result) error(404, 'Analysis not found.');
  return result;
};
