import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { nativeTripOwner, NOT_YOURS } from '$lib/trips/access.server';
import { findIdeas } from '$lib/trips/ideas.server';
import { parseIdeasAsk } from '$lib/trips/intake';
import { getTrip } from '$lib/trips/store.server';

/**
 * POST /api/native/trips/:id/ideas — the phone's "ideas for this slot": the
 * same `{ date, stage, afterStopId?, beforeStopId? }` and answer as the site.
 * Owner only (D2).
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const owner = nativeTripOwner(identity, role);
  if (!owner) return json({ error: NOT_YOURS }, { status: 403 });
  const trip = await getTrip(owner, event.params.id);
  if (!trip) return json({ error: 'No such trip.' }, { status: 404 });
  const parsed = parseIdeasAsk(await event.request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  return findIdeas(trip, parsed.value, 'phone');
});
