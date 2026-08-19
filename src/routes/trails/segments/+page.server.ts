import type { PageServerLoad } from './$types';
import { listSegments } from '$lib/trails/segments-service';
import { segmentDescriptor } from '$lib/trails/segments/naming';

// Owner-gated the same way as the rest of /trails: absent from PUBLIC_PATHS.
//
// The whole list ships once and every filter and sort happens client-side —
// two hundred rows of numbers is cheaper than a round trip per chip. The URL
// params are only read to seed the initial state, so dashboard deep links
// land on a pre-filtered view.
export const load: PageServerLoad = async ({ url }) => {
  const initial = {
    type: url.searchParams.get('type'),
    terrain: url.searchParams.get('terrain'),
    offroad: url.searchParams.get('offroad'),
    sort: url.searchParams.get('sort'),
  };
  try {
    // Well above today's corpus (161 segments): client-side filtering shows a
    // count of 14 on a chip and must then actually have those 14 rows. If the
    // corpus ever nears this, filtering moves back server-side.
    const { rows, types } = await listSegments({ limit: 1000 });
    // The list gives each row its own efforts column, so the descriptor beside
    // the name drops the count and keeps the two facts it adds.
    const segments = rows.map((row) => ({
      ...row,
      shortDescriptor: segmentDescriptor(row, { includeEfforts: false }),
    }));
    return { segments, types, initial, error: null };
  } catch (err) {
    console.warn('[trails] segments list failed:', (err as Error)?.message);
    return { segments: [], types: [], initial, error: 'Could not load segments.' };
  }
};
