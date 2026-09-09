import { requireLabOwner } from '$lib/policy-incentives-lab/server/access';
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = async ({ locals, setHeaders }) => {
  const owner = await requireLabOwner(locals);
  setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' });
  return { labOwner: owner };
};
