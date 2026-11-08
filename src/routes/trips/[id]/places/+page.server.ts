import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireTripOwner } from '$lib/trips/access.server';
import { EMPTY_PACK, type PackPlace, type PackSummary } from '$lib/trips/decisions';
import { localDateIn } from '$lib/trips/routing';
import { getTrip, latestPlan } from '$lib/trips/store.server';

// v8: the research pack browser — every place the trip's research found,
// with its facts, sources and photo, the date facts (closures, events,
// weather), and "Add to the plan". The pack comes from the same route the
// phone uses (GET /api/trips/:id/pack); a pack that is not there yet reads as
// not researched. The plan's days are sent as dates and placed stops only, to
// pick the best day for "Add to the plan".
export const load: PageServerLoad = async (event) => {
  const owner = await requireTripOwner(event);
  const trip = await getTrip(owner, event.params.id);
  if (!trip) error(404, 'No such trip.');
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const [latest, res] = await Promise.all([
    latestPlan(trip.id),
    event
      .fetch(`/api/trips/${encodeURIComponent(trip.id)}/pack`, { headers: { accept: 'application/json' } })
      .then(async (r) => (r.ok ? ((await r.json()) as { pack?: PackSummary; places?: PackPlace[] }) : null))
      .catch(() => null),
  ]);
  return {
    trip: { id: trip.id, title: trip.title, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate },
    days: (latest?.plan.days ?? []).map((d) => ({ date: d.date, stops: d.stops.map((s) => ({ kind: s.kind, location: s.location })) })),
    pack: res?.pack ?? EMPTY_PACK,
    places: Array.isArray(res?.places) ? res.places : [],
    available: !!res,
    today: localDateIn(trip.timeZone, new Date()),
  };
};
