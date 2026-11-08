import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip } from '$lib/trips/api.server';
import { isLocalDate } from '$lib/trips/intake';
import { liveDriveLegs } from '$lib/trips/routing.server';
import { latestPlan } from '$lib/trips/store.server';

/**
 * GET /api/trips/:id/live?date= — live drive times (Mapbox, with traffic) for
 * that day's drive legs. Display only: Mapbox navigation results may not be
 * stored (Product Terms §2.10.1), so this is answered and forgotten — no-store.
 */
export const GET: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  const date = event.url.searchParams.get('date');
  if (!isLocalDate(date)) return json({ error: 'Give ?date=YYYY-MM-DD.' }, { status: 400 });
  const day = (await latestPlan(trip.id))?.plan.days.find((d) => d.date === date);
  if (!day) return json({ error: 'No plan for that day.' }, { status: 404 });
  return json(await liveDriveLegs(day), { headers: { 'cache-control': 'private, no-store' } });
};
