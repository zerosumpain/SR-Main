import type { LayoutServerLoad } from './$types';
import { requireProjectPublic } from '$lib/projects/guard';

// Guards the Broads Pilot route (planner + /method). Mirrors policy-engine.
export const load: LayoutServerLoad = async (event) => {
  const { authedPrivate, viaShare } = await requireProjectPublic('broads-pilot', event);
  // Owner preview OR a shared private view must never be edge-cached or indexed.
  if (authedPrivate || viaShare)
    event.setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
  return {};
};
