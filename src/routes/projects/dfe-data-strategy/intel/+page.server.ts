import type { PageServerLoad } from './$types';
import { requireProjectPublic } from '$lib/projects/guard';
import { getIntelSnapshot } from '../lib/intel.server';

export const load: PageServerLoad = async (event) => {
  const { authedPrivate, viaShare } = await requireProjectPublic('dfe-data-strategy', event);
  const noStore = authedPrivate || viaShare;
  event.setHeaders({
    'cache-control': noStore ? 'private, no-store' : 'public, max-age=0, s-maxage=600',
    ...(noStore ? { 'x-robots-tag': 'noindex' } : {}),
  });
  const snapshot = await getIntelSnapshot();
  return { snapshot, authed: authedPrivate };
};
