import type { PageServerLoad } from "./$types";
import { requireTripOwner } from "$lib/trips/access.server";
import { listTrips } from "$lib/trips/store.server";
import { rosterNames } from "$lib/trips/roster-names.server";

// The owner's trips (D2: owner only — the hook keeps everyone else off /trips,
// and `requireTripOwner` is the second lock). `today` (UTC) splits the index
// into trips still to come and trips already been; a day either side of
// midnight in another zone only moves a trip between the two lists. v8: the
// family roster's names, so the guided start can add someone with a tap.
export const load: PageServerLoad = async (event) => {
  const owner = await requireTripOwner(event);
  event.setHeaders({ "cache-control": "private, no-store" });
  const [trips, family] = await Promise.all([listTrips(owner), rosterNames()]);
  return {
    trips,
    family,
    today: new Date().toISOString().slice(0, 10),
  };
};
