import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { converse } from '$lib/trips/converse.server';
import { nativeTripCaller, NOT_FAMILY_TRIPS } from '$lib/trips/family.server';
import { draftTrip } from '$lib/trips/intake';
import { localDateIn } from '$lib/trips/routing';
import { createTrip, listAllTrips } from '$lib/trips/store.server';

/**
 * GET /api/native/trips — `{ trips: TripSummary[] }`. v5: trips are open to
 * the whole family (owner or Family Circle); anyone else is refused (403).
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await nativeTripCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY_TRIPS }, { status: 403 });
  return { trips: await listAllTrips() };
});

/**
 * POST /api/native/trips — `{ text }`: any family member starts a trip with
 * an opening message and becomes its creator (edits freely). 201 `{ id, ...ConverseResult }`.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await nativeTripCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY_TRIPS }, { status: 403 });
  const body = (await event.request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'Say where and when — the planner takes it from there.' }, { status: 400 });
  const trip = await createTrip(caller.email, draftTrip(localDateIn('Europe/London', new Date())));
  const turn = await converse(trip, { text, surface: 'phone', caller: { isOwner: caller.isOwner, canEdit: true, name: caller.name, email: caller.email } });
  return json({ id: trip.id, ...turn }, { status: 201 });
});
