import type { PageServerLoad } from './$types';
import { requireProjectPublic } from '$lib/projects/guard';
import { getIntelSnapshot } from '../lib/intel.server';

export const load: PageServerLoad = async (event) => {
  // NB: don't set cache-control here — the project +layout.server.ts already sets it,
  // and SvelteKit throws "header is already set" if a child load sets it again.
  const { authedPrivate } = await requireProjectPublic('dfe-data-strategy', event);
  const snapshot = await getIntelSnapshot();
  return { snapshot, authed: authedPrivate };
};
