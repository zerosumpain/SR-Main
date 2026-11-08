import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { nativeTripCaller, NOT_FAMILY_TRIPS } from '$lib/trips/family.server';
import { noteFacts, readNotesQuery } from '$lib/trips/notes.server';

/**
 * GET /api/native/trips/notes?destination=&startDate=&endDate= — v8: the
 * guided start's "Already booked?" step → `{ notes: NoteFact[] }`. The
 * owner's phone only: anyone else in the family gets `[]` (memory is the
 * owner's). No memory text on the wire, the owner included: labels are built
 * from trip facts (carrier, flight number, times, area, dates), `ref` is null.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await nativeTripCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY_TRIPS }, { status: 403 });
  const q = readNotesQuery(event.url.searchParams);
  const notes = q && caller.isOwner ? await noteFacts({ email: caller.email, isOwner: true }, q, { surface: 'phone' }) : [];
  return json({ notes }, { headers: { 'cache-control': 'private, no-store' } });
});
