import { getReleaseShowcase } from '$lib/releases/public';
import type { PageServerLoad } from './$types';

/**
 * Public release history. The owner-only counterpart at /admin/ops/releases has
 * the filters, the raw diffs and the internal work; this has only what
 * $lib/releases/public-filter clears for anonymous readers.
 *
 * Everything is awaited and rendered server-side: the point of the page is to
 * be readable and indexable, so nothing here may depend on client JS.
 */
export const load: PageServerLoad = async ({ url }) => {
  const data = await getReleaseShowcase();

  const kind = url.searchParams.get('kind') || 'all';
  const items = kind === 'all' ? data.items : data.items.filter((i) => i.kind === kind);

  return {
    totals: data.totals,
    cadence: data.cadence,
    kindMix: data.kindMix,
    items,
    kind,
  };
};
