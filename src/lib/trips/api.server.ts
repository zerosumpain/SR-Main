// src/lib/trips/api.server.ts
//
// The shared opening of every /api/trips handler: the owner (D2) and their
// trip, or the site's refusal; then, after an edit to the constraints, a
// re-plan so the page always shows a plan for the constraints it holds.

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireTripOwner } from './access.server';
import { replan } from './plan.server';
import { getTrip, type TripRecord } from './store.server';

export async function ownerTrip(event: RequestEvent): Promise<{ owner: string; trip: TripRecord }> {
  const owner = await requireTripOwner(event);
  const trip = await getTrip(owner, event.params.id ?? '');
  if (!trip) error(404, 'No such trip.');
  return { owner, trip };
}

export async function readJson(event: RequestEvent): Promise<unknown> {
  return event.request.json().catch(() => null);
}

/** Re-plan after an edit and answer with the version the page should now show. */
export async function replanned(trip: TripRecord, extra: Record<string, unknown> = {}, status = 200): Promise<Response> {
  try {
    const { plan, created } = await replan(trip, 'site');
    return json({ ...extra, planVersion: plan.version, replanned: created }, { status });
  } catch (err) {
    // The edit is saved; a failed solve must not read as a failed edit.
    console.error('[trips] re-plan failed:', err);
    return json({ ...extra, planVersion: null, replanned: false, warning: 'Saved, but the plan could not be rebuilt just now.' }, { status });
  }
}
