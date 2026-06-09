import type { PageServerLoad } from './$types';
import { requireProjectPublic } from '$lib/projects/guard';

export const load: PageServerLoad = async (event) => {
  const { authedPrivate, viaShare } = await requireProjectPublic('data-convergence', event);
  if (authedPrivate || viaShare) event.setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
  return {};
};
