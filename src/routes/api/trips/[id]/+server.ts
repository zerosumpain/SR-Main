import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson, replanned } from '$lib/trips/api.server';
import { parseTripInput } from '$lib/trips/intake';
import { deleteTrip, getTrip, updateTrip } from '$lib/trips/store.server';

/** PATCH /api/trips/:id — the intake again (destination, dates, zone, pace, modes, notes); re-plans. */
export const PATCH: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  const body = await readJson(event);
  const parsed = parseTripInput({ ...trip, ...(body && typeof body === 'object' ? body : {}) });
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  await updateTrip(trip.id, parsed.value);
  return replanned((await getTrip(owner, trip.id))!);
};

/** DELETE /api/trips/:id — the trip and everything under it. */
export const DELETE: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  await deleteTrip(trip.id);
  return json({ deleted: true });
};
