import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson, replanned } from '$lib/trips/api.server';
import { reorderWishes } from '$lib/trips/store.server';

/** POST /api/trips/:id/wishes/order — `{ ids }` in the order the person wants; re-plans. */
export const POST: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  const body = (await readJson(event)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((i): i is string => typeof i === 'string').slice(0, 300) : null;
  if (!ids?.length) return json({ error: 'Send { ids }.' }, { status: 400 });
  await reorderWishes(trip.id, ids);
  return replanned(trip);
};
