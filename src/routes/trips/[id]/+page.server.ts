import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireTripOwner } from '$lib/trips/access.server';
import { bookingChecklist } from '$lib/trips/booking';
import { localDateIn } from '$lib/trips/routing';
import { getTrip, latestPlan, loadState, planVersions, recentEvents } from '$lib/trips/store.server';

// One trip: the intake, the wishes and their facts, the booking checklist and
// the latest solved plan with what changed. Every edit on the page goes to
// /api/trips/:id/… (constraints change, the plan is re-solved) and the page
// reloads its data.
export const load: PageServerLoad = async (event) => {
  const owner = await requireTripOwner(event);
  const trip = await getTrip(owner, event.params.id);
  if (!trip) error(404, 'No such trip.');
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const [state, latest, versions, events] = await Promise.all([
    loadState(trip.id),
    latestPlan(trip.id),
    planVersions(trip.id, 12),
    recentEvents(trip.id, 20),
  ]);
  const today = localDateIn(trip.timeZone, new Date());
  return {
    trip,
    stays: state.stays,
    wishes: state.wishes,
    bookings: state.bookings,
    plan: latest
      ? {
          id: latest.id,
          version: latest.version,
          source: latest.source,
          createdAt: latest.createdAt,
          plan: latest.plan,
          changes: latest.changes,
          estimated: latest.matrix?.estimated ?? {},
        }
      : null,
    versions: versions.map((v) => ({ version: v.version, source: v.source, createdAt: v.createdAt, changes: v.changes })),
    checklist: bookingChecklist({ wishes: state.wishes, bookings: state.bookings, plan: latest?.plan ?? null, tripStart: trip.startDate, today }),
    events,
    today,
  };
};
