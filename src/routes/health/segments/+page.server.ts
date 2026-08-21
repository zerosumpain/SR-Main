import type { PageServerLoad } from './$types';
import { listSegments } from '$lib/trails/segments-service';
import { getSegmentChains } from '$lib/trails/highlights-service';
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
    form: url.searchParams.get('form'),
    sort: url.searchParams.get('sort'),
  };
  try {
    // Well above today's corpus (387 segments in production as of 2026-08-21):
    // client-side filtering shows a count of 14 on a chip and must then
    // actually have those 14 rows. If the corpus nears this, filtering moves
    // back server-side.
    // The chains panel is garnish — its failure must not take the explorer down.
    const [{ rows, types }, chains] = await Promise.all([
      listSegments({ limit: 1000 }),
      getSegmentChains().catch((err) => {
        console.warn('[trails] segment chains failed:', (err as Error)?.message);
        return [];
      }),
    ]);
    // The list gives each row its own efforts column, so the descriptor beside
    // the name drops the count and keeps the two facts it adds.
    const segments = rows.map((row) => ({
      ...row,
      shortDescriptor: segmentDescriptor(row, { includeEfforts: false }),
    }));
    return { segments, types, chains, initial, error: null };
  } catch (err) {
    console.warn('[trails] segments list failed:', (err as Error)?.message);
    return { segments: [], types: [], chains: [], initial, error: 'Could not load segments.' };
  }
};
