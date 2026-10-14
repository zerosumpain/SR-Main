import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { nativeTripOwner, NOT_YOURS } from '$lib/trips/access.server';
import { etagMatches } from '$lib/trips/bundle';
import { tripBundle } from '$lib/trips/plan.server';
import { getTrip } from '$lib/trips/store.server';

/**
 * GET /api/native/trips/:id — the whole trip for offline use (`TripBundle`):
 * constraints, the latest plan with its changes, and per day the travel
 * matrix of that day's stops and stay so the phone can re-time without
 * signal. `If-None-Match` with the bundle's ETag answers 304.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const owner = nativeTripOwner(identity, role);
  if (!owner) return json({ error: NOT_YOURS }, { status: 403 });
  const trip = await getTrip(owner, event.params.id);
  if (!trip) return json({ error: 'No such trip.' }, { status: 404 });
  const bundle = await tripBundle(trip);
  const headers = { etag: bundle.etag, 'cache-control': 'private, no-cache' };
  if (etagMatches(event.request.headers.get('if-none-match'), bundle.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return json(bundle, { headers });
});
