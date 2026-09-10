import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { personaDetail } from '$lib/policy-analysis/server/personas';

export const load: PageServerLoad = async (event) => {
  const owner = await requirePolicyOwner(event);
  const detail = await personaDetail(owner, event.params.id);
  if (!detail) error(404, 'Persona not found.');
  return detail;
};
