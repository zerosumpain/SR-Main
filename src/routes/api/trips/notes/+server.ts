import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTripOwner } from '$lib/trips/access.server';
import { noteFacts, readNotesQuery } from '$lib/trips/notes.server';

/**
 * GET /api/trips/notes?destination=&startDate=&endDate= — v8: what the
 * owner's notes already hold for a trip being started (flights, the stay, a
 * booked tour) → `{ notes: NoteFact[] }`, each with ops ready to confirm and
 * the memory it came from (`ref`). Owner only; `[]` when nothing fits.
 */
export const GET: RequestHandler = async (event) => {
  const owner = await requireTripOwner(event);
  const q = readNotesQuery(event.url.searchParams);
  const notes = q ? await noteFacts({ email: owner, isOwner: true }, q, { surface: 'site' }) : [];
  return json({ notes }, { headers: { 'cache-control': 'private, no-store' } });
};
