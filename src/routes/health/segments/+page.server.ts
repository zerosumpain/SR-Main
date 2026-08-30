import type { PageServerLoad } from './$types';
import { listSegments } from '$lib/trails/segments-service';
import { getSegmentChains } from '$lib/trails/highlights-service';

// Owner-gated the same way as the rest of /health: absent from PUBLIC_PATHS,
// so hooks.server.ts holds the door. It must never be added to that list — a
// GPS trace starts at the front door.
//
// The whole list ships once and every filter and sort happens client-side —
// several hundred rows of numbers is cheaper than a round trip per chip. The
// URL is passed through whole so the explorer can seed itself from it, which is
// how a dashboard deep link lands on a pre-filtered view.

/**
 * Well above today's corpus (387 segments in production as of 2026-08-21).
 *
 * Client-side filtering shows a count of 14 on a chip and must then actually
 * have those 14 rows. Hitting the cap is LOGGED and said out loud on the page,
 * because a silently truncated list reads exactly like full coverage: the
 * taxonomy tiles, the chip counts and every record would all be quietly wrong.
 */
const SEGMENT_LIMIT = 1000;

export const load: PageServerLoad = async ({ url }) => {
  try {
    // `listSegments` memoises its two unfiltered corpus scans on the corpus
    // fingerprint, shared with /health's own call — so this page costs the
    // projection and nothing else on a warm cache. Do not "optimise" it into a
    // narrower query; the whole point is that both callers hit one scan.
    //
    // The chains panel is garnish — its failure must not take the explorer down.
    const [{ rows, types }, chains] = await Promise.all([
      listSegments({ limit: SEGMENT_LIMIT }),
      getSegmentChains().catch((err) => {
        console.warn('[trails] segment chains failed:', (err as Error)?.message);
        return [];
      }),
    ]);

    const truncated = rows.length >= SEGMENT_LIMIT;
    if (truncated) {
      console.warn(
        `[trails] segment list hit the ${SEGMENT_LIMIT}-row cap — the table, its taxonomy tiles ` +
          'and its chip counts now cover only the busiest rows. Raise SEGMENT_LIMIT or page the list.',
      );
    }

    return {
      segments: rows,
      types,
      chains,
      truncated,
      limit: SEGMENT_LIMIT,
      initialQuery: url.search,
      error: null,
    };
  } catch (err) {
    console.warn('[trails] segments list failed:', (err as Error)?.message);
    return {
      segments: [],
      types: [],
      chains: [],
      truncated: false,
      limit: SEGMENT_LIMIT,
      initialQuery: url.search,
      error: 'Could not load segments.',
    };
  }
};
