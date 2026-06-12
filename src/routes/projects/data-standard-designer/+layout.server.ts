import { requireProjectPublic } from '$lib/projects/guard';
import type { LayoutServerLoad } from './$types';

// Public by default (no visibility row) — the owner can later toggle it private
// via /projects, and the guard keeps the whole multi-route project consistent.
export const load: LayoutServerLoad = async (event) => {
  const { authedPrivate, viaShare } = await requireProjectPublic('data-standard-designer', event);
  if (authedPrivate || viaShare) event.setHeaders({ 'cache-control': 'private, no-store' });
  return {};
};
