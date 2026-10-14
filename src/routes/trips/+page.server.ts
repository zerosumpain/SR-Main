import type { PageServerLoad } from './$types';
import { requireTripOwner } from '$lib/trips/access.server';
import { listTrips } from '$lib/trips/store.server';

// The owner's trips (D2: owner only — the hook keeps everyone else off /trips,
// and `requireTripOwner` is the second lock).
export const load: PageServerLoad = async (event) => {
  const owner = await requireTripOwner(event);
  event.setHeaders({ 'cache-control': 'private, no-store' });
  return { trips: await listTrips(owner) };
};
