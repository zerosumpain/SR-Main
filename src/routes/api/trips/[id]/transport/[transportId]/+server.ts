import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, replanned } from '$lib/trips/api.server';
import { deleteTransport } from '$lib/trips/store.server';

/** DELETE /api/trips/:id/transport/:transportId — remove a journey; re-plans (the days lose their framing). */
export const DELETE: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  if (!(await deleteTransport(trip.id, event.params.transportId))) return json({ error: 'No such journey.' }, { status: 404 });
  return replanned(trip, { deleted: true }, 200, [{ op: 'removeTransport', id: event.params.transportId }]);
};
