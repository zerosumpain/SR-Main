import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson, replanned } from '$lib/trips/api.server';
import { parseStayInput } from '$lib/trips/intake';
import { addStay } from '$lib/trips/store.server';

/** POST /api/trips/:id/stays — `{ name, address?, location, fromDate, nights | toDate, checkInMin?, checkOutMin? }`; re-plans. */
export const POST: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  const parsed = parseStayInput(await readJson(event), trip);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const stay = await addStay(trip.id, parsed.value);
  return replanned(trip, { stay }, 201);
};
