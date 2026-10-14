import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireTripOwner } from '$lib/trips/access.server';
import { bookingChecklist } from '$lib/trips/booking';
import { localDateIn } from '$lib/trips/routing';
import { startGuidance, withGuidance } from '$lib/trips/guidance.server';
import { gatherProfile } from '$lib/trips/profile.server';
import { getTrip, latestPlan, listTransport, loadState, planVersions, recentEvents, recentMessages, viewerOf } from '$lib/trips/store.server';

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
  // What I know about you (v3): gathered in the background the first time, never awaited here.
  if (!trip.profile) void gatherProfile(trip, { asOwner: true, ownerEmail: owner }).catch(() => {});
  const [state, latest, versions, events, messages, transport] = await Promise.all([
    loadState(trip.id),
    latestPlan(trip.id),
    planVersions(trip.id, 12),
    recentEvents(trip.id, 20),
    // v5: the owner's own thread and the plan changes; a member's advice chat stays theirs.
    recentMessages(trip.id, viewerOf(trip, owner), 50),
    listTransport(trip.id),
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
    transport,
    profile: trip.profile,
    guide: trip.guide,
    today,
    /** v4: the studio's open tab — ?day=YYYY-MM-DD, else the overview. */
    initialDay: (() => {
      const d = event.url.searchParams.get('day');
      return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && latest?.plan.days.some((x) => x.date === d) ? d : 'overview';
    })(),
  };
};
