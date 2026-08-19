import type { PageServerLoad } from './$types';
import { getTrailsDashboard } from '$lib/trails/physio-service';
import { getSegmentHighlights } from '$lib/trails/segments-service';

// Owner-gated the same way as the rest of /trails: absent from PUBLIC_PATHS,
// so hooks.server.ts requires the owner session. Physiological history is
// exactly the kind of thing that stays off the public site.
export const load: PageServerLoad = async () => {
  try {
    const [dashboard, segments] = await Promise.all([
      getTrailsDashboard(),
      // The segments strip is garnish — its failure must not take the
      // physiology down with it.
      getSegmentHighlights().catch((err) => {
        console.warn('[trails] segment highlights failed:', (err as Error)?.message);
        return null;
      }),
    ]);
    return { dashboard, segments, error: null };
  } catch (err) {
    console.warn('[trails] dashboard failed:', (err as Error)?.message);
    return { dashboard: null, segments: null, error: 'Could not load the dashboard.' };
  }
};
