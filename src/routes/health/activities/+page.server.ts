import type { PageServerLoad } from './$types';
import { listActivities } from '$lib/trails/activities-service';
import { getTrailsStrip, type TrailsStrip } from '$lib/trails/physio-service';

// Owner-gated by default: hooks.server.ts treats every path outside
// PUBLIC_PATHS (/health, /tools) as owner-only, so /health/activities needs no gate of
// its own — and must not be added to that list, because a GPS trace starts at
// the front door.
export const load: PageServerLoad = async ({ url }) => {
  const type = url.searchParams.get('type');
  const days = Number(url.searchParams.get('days')) || null;

  // The training-state strip is an enrichment; the list must render without
  // it. The two loads are independent, so they run concurrently.
  const stripPromise: Promise<TrailsStrip | null> = getTrailsStrip().catch((err) => {
    console.warn('[trails] strip failed:', (err as Error)?.message);
    return null;
  });

  try {
    const [result, strip] = await Promise.all([
      listActivities({
        types: type && type !== 'all' ? [type] : undefined,
        sinceDays: days ?? undefined,
        limit: 200,
      }),
      stripPromise,
    ]);
    return { ...result, strip, filter: { type: type ?? 'all', days }, error: null };
  } catch (err) {
    console.warn('[trails] list failed:', (err as Error)?.message);
    return {
      rows: [],
      totals: { count: 0, distanceM: 0, durationS: 0, elevationGainM: 0 },
      types: [],
      strip: await stripPromise,
      filter: { type: type ?? 'all', days },
      error: 'Could not load activities.',
    };
  }
};
