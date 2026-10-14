import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireTripOwner } from '$lib/trips/access.server';
import { bookingChecklist } from '$lib/trips/booking';
import { localDateIn } from '$lib/trips/routing';
import { startGuidance, withGuidance } from '$lib/trips/guidance.server';
import { getTrip, latestPlan, loadState, planVersions, recentEvents, recentMessages } from '$lib/trips/store.server';

// One trip: the planning conversation (v2), the latest solved plan with its
// guidance and what changed, and the constraints the conversation set (intake,
// stays, wishes and facts, the booking checklist) as an editable view. Every edit on the page goes to
// /api/trips/:id/… (constraints change, the plan is re-solved) and the page
// reloads its data.
export const load: PageServerLoad = async (event) => {
  const owner = await requireTripOwner(event);
  const trip = await getTrip(owner, event.params.id);
  if (!trip) error(404, 'No such trip.');
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const [state, latest, versions, events, messages] = await Promise.all([
    loadState(trip.id),
    latestPlan(trip.id),
    planVersions(trip.id, 12),
    recentEvents(trip.id, 20),
    recentMessages(trip.id, 50),
  ]);
  // Guidance for every day is made lazily, on page view, in the background.
  if (latest) startGuidance(owner, trip.id, 'all');
  const plan = latest ? await withGuidance(trip.id, latest.plan) : null;
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
          plan: plan!,
          changes: latest.changes,
          estimated: latest.matrix?.estimated ?? {},
        }
      : null,
    versions: versions.map((v) => ({ version: v.version, source: v.source, createdAt: v.createdAt, changes: v.changes })),
    checklist: bookingChecklist({ wishes: state.wishes, bookings: state.bookings, plan: latest?.plan ?? null, tripStart: trip.startDate, today }),
    events,
    messages,
    guide: trip.guide,
    today,
  };
};
