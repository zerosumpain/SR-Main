import type { PageServerLoad } from './$types';
import { getTrailsDashboard } from '$lib/trails/physio-service';

// Owner-gated the same way as the rest of /trails: absent from PUBLIC_PATHS,
// so hooks.server.ts requires the owner session. Physiological history is
// exactly the kind of thing that stays off the public site.
export const load: PageServerLoad = async () => {
  try {
    return { dashboard: await getTrailsDashboard(), error: null };
  } catch (err) {
    console.warn('[trails] dashboard failed:', (err as Error)?.message);
    return { dashboard: null, error: 'Could not load the dashboard.' };
  }
};
