import type { LayoutServerLoad } from './$types';
import { requireProjectPublic } from '$lib/projects/guard';

// Guards every policy-engine subroute (Overview/Build/Outcomes/Population/
// Regions/Method/Global) in one place.
export const load: LayoutServerLoad = async (event) => {
  const { authedPrivate, viaShare } = await requireProjectPublic('policy-engine', event);
  // Owner preview OR a shared private view must never be edge-cached or indexed.
  if (authedPrivate || viaShare) event.setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
  return {};
};
