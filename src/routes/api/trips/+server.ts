import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTripOwner } from '$lib/trips/access.server';
import { parseTripInput } from '$lib/trips/intake';
import { converse } from '$lib/trips/converse.server';
import { draftTrip } from '$lib/trips/intake';
import { localDateIn } from '$lib/trips/routing';
import { createTrip, getTripById, listTrips } from '$lib/trips/store.server';
import { jobAccepted } from '$lib/trips/jobs.server';
import { ensurePack } from '$lib/trips/pack.server';
import { parseTripStart } from '$lib/trips/start';
import { startTripJob } from '$lib/trips/start.server';

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
 * v8: `{ start: TripStart }` → 202 `{ job }` (the guided start, staged;
 * poll GET /api/trips/jobs/:jobId; `result: { id }`).
 */
export const POST: RequestHandler = async (event) => {
  const owner = await requireTripOwner(event);
  const body = await event.request.json().catch(() => null);
  // v8: the guided start — always a staged job (`result: { id }`).
  if (body && typeof body === 'object' && 'start' in body) {
    const start = parseTripStart((body as { start: unknown }).start);
    if (!start.ok) return json({ error: start.error }, { status: 400 });
    return jobAccepted(startTripJob({ email: owner, name: null, isOwner: true }, start.value, 'site'));
  }
  const text = body && typeof body === 'object' && typeof (body as { text?: unknown }).text === 'string' ? (body as { text: string }).text.trim() : '';
  if (text) {
    const trip = await createTrip(owner, draftTrip(localDateIn('Europe/London', new Date())));
    const turn = await converse(trip, { text, surface: 'site', caller: { isOwner: true, canEdit: true, name: null, email: owner } });
    // v8: research the trip once the planner has said where it is (in the background).
    void getTripById(trip.id).then((t) => t && ensurePack(t, { reason: 'created' })).catch(() => {});
    return json({ id: trip.id, ...turn }, { status: 201 });
  }
  const parsed = parseTripInput(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const trip = await createTrip(owner, parsed.value);
  return json({ id: trip.id }, { status: 201 });
};
