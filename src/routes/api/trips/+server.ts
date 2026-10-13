import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTripOwner } from '$lib/trips/access.server';
import { parseTripInput } from '$lib/trips/intake';
import { createTrip, listTrips } from '$lib/trips/store.server';

/** GET /api/trips — the owner's trips. */
export const GET: RequestHandler = async (event) => {
  const owner = await requireTripOwner(event);
  return json({ trips: await listTrips(owner) }, { headers: { 'cache-control': 'private, no-store' } });
};

/** POST /api/trips — a new trip from the intake form; 201 with its id. */
export const POST: RequestHandler = async (event) => {
  const owner = await requireTripOwner(event);
  const parsed = parseTripInput(await event.request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const trip = await createTrip(owner, parsed.value);
  return json({ id: trip.id }, { status: 201 });
};
