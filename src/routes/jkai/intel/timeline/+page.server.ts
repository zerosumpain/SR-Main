import type { PageServerLoad } from './$types';
import { listTimelineEvents } from '$lib/jkai/intel/queries';
import { getLens, lensEntityIds, listLenses } from '$lib/jkai/intel/lenses';

/**
 * 200 was a list's page size. An axis wants the whole history — a timeline that
 * silently stops two hundred events ago is worse than no timeline, because the
 * gap looks like a quiet period rather than a truncation.
 */
const MAX_EVENTS = 500;

export const load: PageServerLoad = async ({ url }) => {
  const entityId = url.searchParams.get('entityId') ?? undefined;
  const type = url.searchParams.get('type') ?? undefined;
  const lensKey = url.searchParams.get('lens') ?? undefined;

  const [events, lenses] = await Promise.all([
    listTimelineEvents({ limit: MAX_EVENTS, entityId, type }),
    listLenses(),
  ]);

  // A lens narrows ENTITIES, so it reaches the timeline through each event's
  // linked entity. An event with no entity cannot be attributed to a lens, so
  // it drops out — and the count is returned rather than swallowed, because
  // "where did the rest go" is the only question that follows.
  let visible = events;
  let hiddenByLens = 0;
  let activeLens: { id: string; slug: string; name: string; summary: string } | null = null;

  if (lensKey) {
    const lens = await getLens(lensKey);
    if (lens) {
      const ids = new Set(await lensEntityIds(lens.filters));
      visible = events.filter((e) => e.entityId && ids.has(e.entityId));
      hiddenByLens = events.length - visible.length;
      activeLens = { id: lens.id, slug: lens.slug, name: lens.name, summary: lens.summary };
    }
  }

  return {
    events: visible,
    lenses,
    activeLens,
    hiddenByLens,
    truncated: events.length >= MAX_EVENTS,
    filters: { entityId, type, lens: lensKey ?? null },
  };
};
