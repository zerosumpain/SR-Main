import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { converse } from '$lib/trips/converse.server';
import { nativeTripCaller, NOT_FAMILY_TRIPS } from '$lib/trips/family.server';
import { draftTrip } from '$lib/trips/intake';
import { jobAccepted, startJob, wantsAsync, type JobHandle } from '$lib/trips/jobs.server';
import { localDateIn } from '$lib/trips/routing';
import { createTrip, getTripById, listAllTrips } from '$lib/trips/store.server';
import { ensurePack } from '$lib/trips/pack.server';
import { parseTripStart } from '$lib/trips/start';
import { startTripJob } from '$lib/trips/start.server';

/**
 * GET /api/native/trips — `{ trips: TripSummary[] }`. v5: trips are open to
 * the whole family (owner or Family Circle); anyone else is refused (403).
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await nativeTripCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY_TRIPS }, { status: 403 });
  return { trips: await listAllTrips() };
});

/**
 * POST /api/native/trips — `{ text }`: any family member starts a trip with
 * an opening message and becomes its creator (edits freely). 201 `{ id, ...ConverseResult }`.
 * v6: `"async": true` → 202 `{ job }`; the job's result is that same `{ id, ...ConverseResult }`.
 * A job that fails after the trip was created still carries `result: { id }`.
 * v8: `{ start: TripStart }` (guided: where, when, who, pace, confirmed notes,
 * anything typed) → 202 `{ job }` with stages (setting up, the research,
 * ways to do it, quick questions); `result: { id }` is kept as soon as the
 * trip exists, and `DELETE …/jobs/:jobId` stops it between stages.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await nativeTripCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY_TRIPS }, { status: 403 });
  const body = (await event.request.json().catch(() => null)) as { text?: unknown; start?: unknown } | null;
  // v8: the guided start — always a staged job (`result: { id }`, kept as soon as the trip exists).
  if (body && body.start !== undefined) {
    const start = parseTripStart(body.start);
    if (!start.ok) return json({ error: start.error }, { status: 400 });
    return jobAccepted(startTripJob({ email: caller.email, name: caller.name, isOwner: caller.isOwner }, start.value, 'phone'));
  }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'Say where and when — the planner takes it from there.' }, { status: 400 });
  const run = async (job?: JobHandle) => {
    const trip = await createTrip(caller.email, draftTrip(localDateIn('Europe/London', new Date())));
    // The trip exists from here: a job that fails or is capped later still
    // hands back its id, so the phone can open it instead of losing it.
    job?.keep({ id: trip.id });
    const turn = await converse(trip, { text, surface: 'phone', caller: { isOwner: caller.isOwner, canEdit: true, name: caller.name, email: caller.email, personId: caller.personId } });
    // v8: research the trip once the planner has said where it is (in the background).
    void getTripById(trip.id).then((t) => t && ensurePack(t, { reason: 'created' })).catch(() => {});
    return { id: trip.id, ...turn };
  };
  if (wantsAsync(body)) return jobAccepted(startJob(caller.email, 'create', run));
  return json(await run(), { status: 201 });
});
