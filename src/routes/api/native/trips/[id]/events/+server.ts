import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { nativeTripOwner, NOT_YOURS } from '$lib/trips/access.server';
import { parseEventsBody } from '$lib/trips/intake';
import { applyEvents } from '$lib/trips/plan.server';
import { getTrip } from '$lib/trips/store.server';

/**
 * POST /api/native/trips/:id/events — `{ events: TripEvent[], basePlanVersion }`
 * → `{ accepted: clientIds, planVersion }`. Idempotent on `clientId`: a
 * repeated event is accepted again and applied once. `option-applied` with
 * `detail.day` stores a phone plan version replacing that day only.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const owner = nativeTripOwner(identity, role);
  if (!owner) return json({ error: NOT_YOURS }, { status: 403 });
  const trip = await getTrip(owner, event.params.id);
  if (!trip) return json({ error: 'No such trip.' }, { status: 404 });
  const parsed = parseEventsBody(await event.request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  return applyEvents(trip, parsed.value.events);
});
