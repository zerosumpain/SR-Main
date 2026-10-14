import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTripOwner } from '$lib/trips/access.server';
import { parseTripInput } from '$lib/trips/intake';
import { converse } from '$lib/trips/converse.server';
import { draftTrip } from '$lib/trips/intake';
import { localDateIn } from '$lib/trips/routing';
import { createTrip, listTrips } from '$lib/trips/store.server';

/** GET /api/trips — the owner's trips. */
export const GET: RequestHandler = async (event) => {
  const owner = await requireTripOwner(event);
  return json({ trips: await listTrips(owner) }, { headers: { 'cache-control': 'private, no-store' } });
};

/**
 * POST /api/trips — a new trip. `{ text }` (v2) starts it as a conversation:
 * a draft trip is made and the opening message is the planner's first turn
 * ("Rome, 27–30 Oct, staying near Campo de' Fiori…") → 201 `{ id, ...ConverseResult }`.
 * The intake form's fields still work → 201 `{ id }`.
 */
export const POST: RequestHandler = async (event) => {
  const owner = await requireTripOwner(event);
  const body = await event.request.json().catch(() => null);
  const text = body && typeof body === 'object' && typeof (body as { text?: unknown }).text === 'string' ? (body as { text: string }).text.trim() : '';
  if (text) {
    const trip = await createTrip(owner, draftTrip(localDateIn('Europe/London', new Date())));
    const turn = await converse(trip, { text, surface: 'site', caller: { isOwner: true, canEdit: true, name: null, email: owner } });
    return json({ id: trip.id, ...turn }, { status: 201 });
  }
  const parsed = parseTripInput(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const trip = await createTrip(owner, parsed.value);
  return json({ id: trip.id }, { status: 201 });
};
