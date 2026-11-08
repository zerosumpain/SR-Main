import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { replan } from '$lib/trips/plan.server';
import { startResearch } from '$lib/trips/research.server';
import { getTrip, isUuid } from '$lib/trips/store.server';

/** GET /api/trips/:id/research — the scan's progress, for the page to poll. */
export const GET: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  return json({ research: trip.research }, { headers: { 'cache-control': 'private, no-store' } });
};

/**
 * POST /api/trips/:id/research — `{}` scans every wish not yet researched
 * (brief, D4); `{ wishId }` is "look deeper" for one wish. 202 when started,
 * 409 when a scan is already running. The plan is rebuilt when it finishes.
 */
export const POST: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  const body = (await readJson(event)) as { wishId?: unknown } | null;
  const wishId = typeof body?.wishId === 'string' ? body.wishId : null;
  if (wishId && !isUuid(wishId)) return json({ error: 'No such wish.' }, { status: 404 });
  const started = await startResearch(owner, trip.id, {
    wishIds: wishId ? [wishId] : null,
    depth: wishId ? 'deep' : 'brief',
    onDone: async (id) => {
      const fresh = await getTrip(owner, id);
      if (fresh) await replan(fresh, 'site');
    },
  });
  if (!started) return json({ error: 'A scan is already running for this trip.' }, { status: 409 });
  return json({ started: true }, { status: 202 });
};
