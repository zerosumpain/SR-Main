import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { detail } from '$lib/policy-analysis/server/store';
export const GET: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  const result = await detail(owner, event.params.id);
  if (!result) error(404, 'Analysis not found.');
  return json(result);
};
