import { error } from '@sveltejs/kit';
import { isOwnerRequest, type OwnerCheckEvent } from '$lib/server/owner';
import { ensureOwnerActivityPrincipal } from './store/principals.server';

/**
 * Phase-one request boundary. The central hook already owner-gates these
 * routes; checking again keeps activity ownership true if a route is moved
 * under a public prefix later.
 */
export async function requireOwnerActivityPrincipal(event: OwnerCheckEvent) {
  if (!(await isOwnerRequest(event))) throw error(403, 'Owner access required');
  return ensureOwnerActivityPrincipal();
}
