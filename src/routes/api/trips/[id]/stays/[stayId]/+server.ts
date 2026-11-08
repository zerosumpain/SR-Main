import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, replanned } from '$lib/trips/api.server';
import { deleteStay } from '$lib/trips/store.server';

/** DELETE /api/trips/:id/stays/:stayId; re-plans. */
export const DELETE: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  if (!(await deleteStay(trip.id, event.params.stayId))) return json({ error: 'No such stay.' }, { status: 404 });
  return replanned(trip, { deleted: true }, 200, [{ op: 'removeStay', id: event.params.stayId }]);
};
