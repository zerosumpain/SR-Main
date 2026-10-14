import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson, replanned } from '$lib/trips/api.server';
import { parseWishPatch } from '$lib/trips/intake';
import { deleteWish, updateWish } from '$lib/trips/store.server';

/**
 * PATCH /api/trips/:id/wishes/:wishId — must/nice, lock, part of day, move to
 * a day (`fixedDate`), fixed time, accept a suggestion (`suggested: false`),
 * skip. Every edit changes a CONSTRAINT and re-plans into a new version.
 */
export const PATCH: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  const parsed = parseWishPatch(await readJson(event));
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const wish = await updateWish(trip.id, event.params.wishId, parsed.value);
  if (!wish) return json({ error: 'No such wish.' }, { status: 404 });
  const { place, durationSec, ...rest } = parsed.value;
  const fields = { ...rest, ...(durationSec !== undefined ? { durationMin: durationSec === null ? null : Math.round(durationSec / 60) } : {}), ...(place !== undefined ? { placeQuery: place?.name ?? null } : {}) };
  return replanned(trip, { wish }, 200, [{ op: 'updateWish', id: wish.id, fields: fields as never }]);
};

/** DELETE — remove a wish (rejecting a suggestion is this too); re-plans. */
export const DELETE: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  if (!(await deleteWish(trip.id, event.params.wishId))) return json({ error: 'No such wish.' }, { status: 404 });
  return replanned(trip, { deleted: true }, 200, [{ op: 'removeWish', id: event.params.wishId }]);
};
