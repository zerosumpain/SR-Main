import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson, replanned } from '$lib/trips/api.server';
import { parseBookingPatch } from '$lib/trips/intake';
import { isUuid, loadState, saveBooking } from '$lib/trips/store.server';

/**
 * POST /api/trips/:id/bookings — record a booking the person made elsewhere
 * (D5: the site never books): `{ wishId? | bookingId?, title?, status,
 * reference?, url?, date?, startMin?, endMin? }`. A booked slot is a hard
 * window for the solver, so this re-plans.
 */
export const POST: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  const body = (await readJson(event)) as Record<string, unknown> | null;
  const parsed = parseBookingPatch(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const bookingId = typeof body?.bookingId === 'string' ? body.bookingId : null;
  let wishId = typeof body?.wishId === 'string' ? body.wishId : null;
  if (wishId && !isUuid(wishId)) return json({ error: 'No such wish.' }, { status: 404 });
  let title = parsed.value.title ?? '';
  if (!bookingId) {
    const { wishes, bookings } = await loadState(trip.id);
    const wish = wishId ? wishes.find((w) => w.id === wishId) : null;
    if (wishId && !wish) return json({ error: 'No such wish.' }, { status: 404 });
    const existing = wishId ? bookings.find((b) => b.wishId === wishId) : null;
    if (existing) {
      const booking = await saveBooking(trip.id, { bookingId: existing.id, wishId, title: existing.title }, parsed.value);
      return replanned(trip, { booking }, 200, [{ op: 'updateBooking', id: existing.id, fields: parsed.value }]);
    }
    title = title || wish?.title || '';
    if (!title) return json({ error: 'Name the booking.' }, { status: 400 });
  } else {
    wishId = null;
  }
  const booking = await saveBooking(trip.id, { bookingId, wishId, title }, parsed.value);
  if (!booking) return json({ error: 'No such booking.' }, { status: 404 });
  const { id, ...rest } = booking;
  return replanned(trip, { booking }, 200, [bookingId ? { op: 'updateBooking', id, fields: parsed.value } : { op: 'addBooking', booking: rest }]);
};
