import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { nativeTripOwner, NOT_YOURS } from '$lib/trips/access.server';
import { parseReplanBody } from '$lib/trips/intake';
import { replanOptions } from '$lib/trips/plan.server';
import { getTrip } from '$lib/trips/store.server';

/**
 * POST /api/native/trips/:id/replan — `{ date, nowMin, position, atStopId,
 * doneStopIds }` → `{ options: ReplanOption[] }`, at most three, best first.
 * Nothing is stored until the phone applies one (an `option-applied` event).
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const owner = nativeTripOwner(identity, role);
  if (!owner) return json({ error: NOT_YOURS }, { status: 403 });
  const trip = await getTrip(owner, event.params.id);
  if (!trip) return json({ error: 'No such trip.' }, { status: 404 });
  const parsed = parseReplanBody(await event.request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  return { options: await replanOptions(trip, parsed.value) };
});
