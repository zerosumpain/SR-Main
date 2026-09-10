import type { PageServerLoad } from './$types';
import { requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { listPersonas } from '$lib/policy-analysis/server/personas';

export const load: PageServerLoad = async (event) => {
  const owner = await requirePolicyOwner(event);
  return { personas: await listPersonas(owner) };
};
