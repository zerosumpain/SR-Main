import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireProjectPublic } from '$lib/projects/guard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  await requireProjectPublic('hex', event);
  event.setHeaders({ 'cache-control': 'private, no-store' });
  // The standalone game owns its UI, runtime and learning state.
  if (env.HEX_APP_URL) {
    const destination = new URL(env.HEX_APP_URL);
    if (['https:', 'http:'].includes(destination.protocol)) redirect(307, destination.href);
  }
  return {};
};
