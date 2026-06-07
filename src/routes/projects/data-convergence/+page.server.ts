import type { PageServerLoad } from './$types';
import { requireProjectPublic } from '$lib/projects/guard';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  const { authedPrivate } = await requireProjectPublic('data-convergence', locals);
  if (authedPrivate) setHeaders({ 'cache-control': 'private, no-store' });
  return {};
};
