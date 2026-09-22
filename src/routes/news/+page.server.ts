import type { PageServerLoad } from './$types';
import { newsOwnerKey } from '$lib/news/favourites';
import { loadNewsDesk, parseNewsSort, parseNewsView } from '$lib/news/desk';
import { normalizeNewsLimit } from '$lib/news/sources';

// The desk itself lives in `$lib/news/desk` — the iPhone app is a second reader
// of it, and the two must keep printing the same counts. This loader is now
// only the URL contract: which view, which sort, how many, and force.
//
// `StoryCorrelation` moved there with it and is deliberately NOT re-exported:
// a `+page.server.ts` may only export `load` and SvelteKit's own route options,
// and the postbuild `analyse` step fails the build on anything else. Import it
// from `$lib/news/desk`.

export const load: PageServerLoad = async ({ url, locals }) => {
  const view = parseNewsView(url.searchParams.get('view'));
  return loadNewsDesk({
    view,
    sort: parseNewsSort(url.searchParams.get('sort'), view),
    limit: normalizeNewsLimit(url.searchParams.get('limit')),
    force: url.searchParams.has('fresh'),
    ownerKey: await newsOwnerKey(locals),
  });
};
