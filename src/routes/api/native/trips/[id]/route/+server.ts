import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyTrip } from '$lib/trips/family.server';
import { legKey } from '$lib/trips/guidance';
import { readGuidance } from '$lib/trips/guidance.server';
import { parseRouteQuery } from '$lib/trips/intake';
import { legDepartIso, localDateIn } from '$lib/trips/routing';
import { routeFor } from '$lib/trips/routing.server';
import { latestPlan } from '$lib/trips/store.server';

/**
 * GET /api/native/trips/:id/route?from=<stopId>&to=<stopId>&mode=<mode>&date=<date>
 * → `{ line, durationSec, distanceM, estimated, guidance }` for any mode:
 * openrouteservice, Transitous or an estimate — never a stored Mapbox figure.
 * Display only: it does not change the plan. Any family member.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  const q = parseRouteQuery(event.url.searchParams);
  if (!q.ok) return json({ error: q.error }, { status: 400 });
  const day = (await latestPlan(ft.trip.id))?.plan.days.find((d) => d.date === q.value.date);
  const from = day?.stops.find((s) => s.id === q.value.from);
  const to = day?.stops.find((s) => s.id === q.value.to);
  if (!day || !from || !to) return json({ error: 'Those stops are not on that day of the plan.' }, { status: 404 });
  if (!from.location || !to.location) return json({ error: 'One of those stops has no position.' }, { status: 422 });
  // Asked for when the leg leaves (a timetable that exists: see timetableDate).
  const departIso = legDepartIso(q.value.date, from.departMin, localDateIn(ft.trip.timeZone, new Date()), ft.trip.timeZone);
  const route = await routeFor(ft.trip.id, q.value.mode, from.location, to.location, departIso);
  const guidance = (await readGuidance(ft.trip.id))[legKey(day.date, q.value.mode, from.location, to.location)] ?? null;
  return { ...route, guidance };
});
