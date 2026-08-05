import type { LayoutServerLoad } from './$types';
import { requireProjectPublic } from '$lib/projects/guard';

// Same gate as the other field studies. Visibility is public-by-default — the study is
// only hidden once a project_visibility row (is_public=false) exists for this key;
// owner + share-token holders always pass. See lib/projects/visibility.ts.
export const load: LayoutServerLoad = async (event) => {
  const { authedPrivate, viaShare } = await requireProjectPublic('engine-room', event);
  const noStore = authedPrivate || viaShare;
  event.setHeaders({
    'cache-control': noStore ? 'private, no-store' : 'public, max-age=0, s-maxage=600',
    ...(noStore ? { 'x-robots-tag': 'noindex' } : {}),
  });
  return {};
};
