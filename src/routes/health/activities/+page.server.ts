import type { PageServerLoad } from './$types';
import { listActivities } from '$lib/trails/activities-service';
import { getTrailsStrip, type TrailsStrip } from '$lib/trails/physio-service';
import { getHighlightCorpus, type Highlight } from '$lib/trails/highlights-service';

// Owner-gated by default: hooks.server.ts treats every path outside
// PUBLIC_PATHS (/health, /tools) as owner-only, so /health/activities needs no gate of
// its own — and must not be added to that list, because a GPS trace starts at
// the front door.

/**
 * The whole list ships once and every filter is a pass over it in the browser,
 * the shape /health/segments already uses. Production holds 1,136 activities;
 * the cap is set well clear of that and its being hit is LOGGED, because a
 * silently truncated list reads exactly like full coverage — the totals strip,
 * the type counts and every "3rd fastest" would all be quietly wrong.
 */
const LIST_LIMIT = 2000;

export const load: PageServerLoad = async ({ url }) => {
  // The training-state strip is an enrichment; the list must render without
  // it. The loads are independent, so they run concurrently.
  const stripPromise: Promise<TrailsStrip | null> = getTrailsStrip().catch((err) => {
    console.warn('[trails] strip failed:', (err as Error)?.message);
    return null;
  });

  // Same fail-soft shape for the excellence engine: a highlight failure costs
  // the badges, never the table.
  const highlightPromise = getHighlightCorpus().catch((err) => {
    console.warn('[trails] highlights failed:', (err as Error)?.message);
    return null;
  });

  try {
    const [result, strip, corpus] = await Promise.all([
      listActivities({ limit: LIST_LIMIT }),
      stripPromise,
      highlightPromise,
    ]);

    const truncated = result.rows.length >= LIST_LIMIT;
    if (truncated) {
      console.warn(
        `[trails] activity list hit the ${LIST_LIMIT}-row cap — the table, its totals and its ` +
          'type counts now cover only the most recent rows. Raise LIST_LIMIT or page the list.',
      );
    }

    // A Map does not survive SvelteKit's serialisation cleanly, and only the
    // LEAD highlight is shipped: there are around five per activity and this
    // payload is already 1,100-odd rows wide.
    const highlights: Record<string, Highlight> = {};
    if (corpus) {
      for (const row of result.rows) {
        const lead = corpus.byActivity.get(row.id)?.[0];
        if (lead) highlights[row.id] = lead;
      }
    }

    return {
      ...result,
      strip,
      highlights,
      highlightsFailed: corpus == null,
      truncated,
      limit: LIST_LIMIT,
      initialQuery: url.search,
      error: null,
    };
  } catch (err) {
    console.warn('[trails] list failed:', (err as Error)?.message);
    return {
      rows: [],
      totals: { count: 0, distanceM: 0, durationS: 0, elevationGainM: 0 },
      types: [],
      strip: await stripPromise,
      highlights: {} as Record<string, Highlight>,
      highlightsFailed: true,
      truncated: false,
      limit: LIST_LIMIT,
      initialQuery: url.search,
      error: 'Could not load activities.',
    };
  }
};
