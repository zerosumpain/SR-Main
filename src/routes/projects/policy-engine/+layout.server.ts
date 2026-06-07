import type { LayoutServerLoad } from './$types';
import { requireProjectPublic } from '$lib/projects/guard';

// Guards every policy-engine subroute (Overview/Build/Outcomes/Population/
// Regions/Method/Global) in one place.
export const load: LayoutServerLoad = async ({ locals, setHeaders }) => {
  const { authedPrivate } = await requireProjectPublic('policy-engine', locals);
  if (authedPrivate) setHeaders({ 'cache-control': 'private, no-store' });
  return {};
};
