import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveShare } from '$lib/policy-analysis/server/shares';

/**
 * The one anonymous door into this feature.
 *
 * Unknown, revoked, expired and deleted all end here as the same 404, so a
 * probe learns nothing about whether a token ever existed. Nothing is read from
 * the session: a share link is a capability, and adding "unless you are signed
 * in" would be a second, untested path to the same data.
 */
export const load: PageServerLoad = async (event) => {
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const shared = await resolveShare(event.params.token);
  if (!shared) error(404, 'This link is not valid. It may have been revoked, or it may have expired.');
  return shared;
};
