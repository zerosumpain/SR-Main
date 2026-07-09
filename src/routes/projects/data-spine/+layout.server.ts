import type { LayoutServerLoad } from './$types';
import { requireProjectPublic } from '$lib/projects/guard';

// Gated by the per-project visibility toggle. NOTE: visibility is public-by-default —
// the project is only private once a project_visibility row (is_public=false) exists.
// That row is seeded on prod at deploy time; owner + share-token holders always pass.
export const load: LayoutServerLoad = async (event) => {
  const { authedPrivate, viaShare } = await requireProjectPublic('data-spine', event);
  const noStore = authedPrivate || viaShare;
  event.setHeaders({
    'cache-control': noStore ? 'private, no-store' : 'public, max-age=0, s-maxage=600',
    ...(noStore ? { 'x-robots-tag': 'noindex' } : {}),
  });
  return {};
};
