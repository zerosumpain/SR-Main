import type { PageServerLoad } from './$types';
import { getRegistrySnapshot } from '$lib/data-standard-designer/discovery.server';

// Loads the discovered-standards registry for the portal. Tolerant: if the
// table doesn't exist yet (pre-first-ingest) or the DB hiccups, render an
// empty portal rather than 500.
export const load: PageServerLoad = async ({ parent, setHeaders }) => {
  await parent();
  try {
    const snapshot = await getRegistrySnapshot();
    setHeaders({ 'cache-control': 'public, max-age=0, s-maxage=300' });
    return { snapshot, error: null as string | null };
  } catch (e: any) {
    return { snapshot: { entries: [], sourceHealth: [], watches: [] }, error: String(e?.message || e) };
  }
};
