import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { nativeTripOwner, NOT_YOURS } from '$lib/trips/access.server';
import { listTrips } from '$lib/trips/store.server';

/**
 * GET /api/native/trips — `{ trips: TripSummary[] }`, the owner's trips. Owner
 * only until phase 5 (D2): a member's phone is refused with 403.
 */
export const GET: RequestHandler = withNativeAccess('any', async (_event, identity, role) => {
  const owner = nativeTripOwner(identity, role);
  if (!owner) return json({ error: NOT_YOURS }, { status: 403 });
  return { trips: await listTrips(owner) };
});
