import type { PageServerLoad } from './$types';
import { listActivities } from '$lib/trails/activities-service';

// Owner-gated by default: hooks.server.ts treats every path outside
// PUBLIC_PATHS (/health, /tools) as owner-only, so /trails needs no gate of
// its own — and must not be added to that list, because a GPS trace starts at
// the front door.
export const load: PageServerLoad = async ({ url }) => {
  const type = url.searchParams.get('type');
  const days = Number(url.searchParams.get('days')) || null;

  try {
    const result = await listActivities({
      types: type && type !== 'all' ? [type] : undefined,
      sinceDays: days ?? undefined,
      limit: 200,
    });
    return { ...result, filter: { type: type ?? 'all', days }, error: null };
  } catch (err) {
    console.warn('[trails] list failed:', (err as Error)?.message);
    return {
      rows: [],
      totals: { count: 0, distanceM: 0, durationS: 0, elevationGainM: 0 },
      types: [],
      filter: { type: type ?? 'all', days },
      error: 'Could not load activities.',
    };
  }
};
