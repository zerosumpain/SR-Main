import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';

// /projects is a public hook prefix for shareable project pages. This location
// dashboard does not participate in project sharing: a request must be the owner.
export const load: PageServerLoad = async (event) => {
  if (!(await isOwnerRequest(event))) throw error(404, 'Not found');
  event.setHeaders({ 'cache-control': 'private, no-store' });
};
