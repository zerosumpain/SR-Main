// src/lib/trips/start.server.ts
//
// v8: the guided start, the I/O half (./start has the rules). One `start`
// job, staged so the phone shows real progress instead of a seconds counter:
//
//   Setting up the trip          the trip from the start's fields (the time
//                                zone from Open-Meteo's geocoder), the
//                                travellers with their roster ids, the notes
//                                the owner confirmed applied (provenance
//                                'notes'), anything typed kept for the
//                                planner, the first plan — and the trip's id
//                                kept at once, so it is never lost
//   Finding places … Writing it up   the research pack (./pack.server)
//   Drafting ways to do it       two or three trip shapes (./shapes.server)
//   A few quick questions        the questions that matter now (./questions.server)
//
// The result is `{ id }`. A cancel is heard between stages; the trip made so
// far stays (the job's result still carries its id). A research step that
// fails does not fail the start: the trip is there and can be researched again.

import type { ProvenanceEntry, TripStart } from './decisions';
import { noteProvenance } from './decisions.store.server';
import { applyAndReplan } from './converse.server';
import { draftTrip, parseTripInput } from './intake';
import { JobCancelled, startJob, type JobHandle, type TripJob } from './jobs.server';
import { buildPack, geocode } from './pack.server';
import { replan } from './plan.server';
import { gatherProfile, saveProfile } from './profile.server';
import { mergeProfile } from './profile';
import { provenanceKeys } from './provenance-ops';
import { refreshQuestions } from './questions.server';
import { requestShapes } from './shapes.server';
import { linkBookings, noteOpsInTwo, START_STAGES, startDetail, startTravellers } from './start';
import { createTrip, getTripById, latestPlan, listTransport, loadState, type TripRecord } from './store.server';
import { confirmedNotes } from './notes.server';

export interface StartCaller {
  email: string;
  name: string | null;
  /** The site owner: only then is memory read (the profile, the confirmed notes). */
  isOwner: boolean;
}

/** The steps, swappable in tests. */
export interface StartSteps {
  zoneOf(destination: string): Promise<string | null>;
  roster(): Promise<Array<{ id: string; name: string }>>;
  pack(trip: TripRecord, handle: JobHandle): Promise<unknown>;
  shapes(trip: TripRecord, caller: StartCaller, handle: JobHandle): Promise<unknown[]>;
  questions(trip: TripRecord): Promise<unknown[]>;
}

const LIVE: StartSteps = {
  zoneOf: async (destination) => (await geocode(destination).catch(() => null))?.timeZone ?? null,
  async roster() {
    const { familyRoster } = await import('$lib/family/roster.server');
    return (await familyRoster()).map((p) => ({ id: p.id, name: p.name }));
  },
  pack: (trip, handle) => buildPack(trip, handle),
  shapes: (trip, caller, handle) => requestShapes(trip, { email: caller.email, isOwner: caller.isOwner }, { handle }),
  questions: (trip) => refreshQuestions(trip, { reason: 'start' }),
};

const FALLBACK_ZONE = 'Europe/London';

async function stop(handle: JobHandle): Promise<void> {
  if (await handle.cancelled()) throw new JobCancelled();
}

/** The whole start. Returns `{ id }`. */
export async function runStart(caller: StartCaller, start: TripStart, surface: 'site' | 'phone', job: JobHandle, steps: StartSteps = LIVE): Promise<{ id: string }> {
  // What each stage last reported, so a research step that stops part way is shown as stopped.
  const states = new Map<string, string>();
  const handle: JobHandle = {
    keep: (p) => job.keep(p),
    cancelled: () => job.cancelled(),
    stage: (key, state, detail) => {
      states.set(key, state);
      job.stage(key, state, detail);
    },
  };
  // ── Setting up the trip
  handle.stage('brief', 'running');
  const zone = await steps.zoneOf(start.destination).catch(() => null);
  const parsed = parseTripInput({
    ...draftTrip(start.startDate),
    title: start.destination.split(',')[0],
    destination: start.destination,
    timeZone: zone ?? FALLBACK_ZONE,
    startDate: start.startDate,
    endDate: start.endDate,
    pace: start.pace,
    // What they typed is kept for the planner (and shapes) as the trip's notes.
    notes: start.text,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  let trip = await createTrip(caller.email, parsed.value);
  handle.keep({ id: trip.id });

  const provenance: Record<string, Omit<ProvenanceEntry, 'at'>> = {
    destination: { source: 'you', note: zone ? null : `Time zone not found — assumed ${FALLBACK_ZONE}`, ref: null },
    dates: { source: 'you', note: null, ref: null },
    pace: { source: 'you', note: null, ref: null },
  };
  // Who is going: the owner's profile (from memory) for the owner's own trip, then the people chosen.
  let profile = caller.isOwner ? await gatherProfile(trip, { asOwner: true, ownerEmail: caller.email }).catch(() => null) : null;
  if (start.travellers.length) {
    const roster = await steps.roster().catch(() => []);
    profile = mergeProfile(profile, { travellers: startTravellers(start, roster) }, new Date().toISOString());
    provenance.travellers = { source: 'you', note: null, ref: null };
  }
  if (profile) await saveProfile(trip.id, profile);
  await noteProvenance(trip.id, provenance).catch((err) => console.warn('[trips/start] provenance not recorded:', (err as Error)?.message));
  trip = (await getTripById(trip.id)) ?? trip;

  // What the owner's notes already hold, as they confirmed it.
  const notes = caller.isOwner && start.confirmNotes.length ? await confirmedNotes({ email: caller.email, isOwner: true }, { destination: start.destination, startDate: start.startDate, endDate: start.endDate }, start.confirmNotes).catch(() => []) : [];
  if (notes.length) {
    const before = { ...(await loadState(trip.id)), transport: await listTransport(trip.id) };
    const { first, bookings } = noteOpsInTwo(notes);
    const eventText = `From your notes: ${notes.map((n) => n.label).join('; ')}.`;
    if (first.length) await applyAndReplan(trip, first, { surface, eventText, trustedPlaces: false });
    if (bookings.length) await applyAndReplan(trip, linkBookings(bookings, (await loadState(trip.id)).wishes), { surface, eventText: 'Bookings from your notes.', trustedPlaces: false });
    const after = { ...(await loadState(trip.id)), transport: await listTransport(trip.id) };
    const entries: Record<string, Omit<ProvenanceEntry, 'at'>> = {};
    for (const n of notes) for (const k of provenanceKeys(n.ops, before, after)) entries[k] = { source: 'notes', note: n.label, ref: n.ref };
    await noteProvenance(trip.id, entries).catch(() => {});
    trip = (await getTripById(trip.id)) ?? trip;
  }
  // The first plan, so everything after has something to check against.
  if (!(await latestPlan(trip.id))) await replan(trip, surface === 'phone' ? 'phone' : 'site').catch((err) => console.warn('[trips/start] first plan failed:', (err as Error)?.message));
  handle.stage('brief', 'done', startDetail(start));
  await stop(handle);

  // ── The research pack (its own five stages, on this job's card)
  try {
    await steps.pack(trip, handle);
  } catch (err) {
    if (err instanceof JobCancelled) throw err;
    console.warn('[trips/start] research did not finish:', (err as Error)?.message);
    for (const s of START_STAGES.slice(1, 6)) {
      const was = states.get(s.key);
      if (was === 'running') handle.stage(s.key, 'failed', 'The research did not finish — it can be run again from the trip');
      else if (!was || was === 'waiting') handle.stage(s.key, 'skipped');
    }
  }
  await stop(handle);

  // ── Drafting ways to do it
  handle.stage('shapes', 'running');
  try {
    const shapes = await steps.shapes(trip, caller, handle);
    handle.stage('shapes', 'done', shapes.length ? `${shapes.length} ways to do it` : 'Not enough in the research yet');
  } catch (err) {
    if (err instanceof JobCancelled) throw err;
    console.warn('[trips/start] shapes failed:', (err as Error)?.message);
    handle.stage('shapes', 'failed', 'Could not draft them just now');
  }
  await stop(handle);

  // ── A few quick questions
  handle.stage('questions', 'running');
  const fresh = (await getTripById(trip.id)) ?? trip;
  const asked = await steps.questions(fresh).catch(() => []);
  handle.stage('questions', 'done', asked.length ? `${asked.length} quick ${asked.length === 1 ? 'question' : 'questions'}` : 'Nothing to ask just now');
  return { id: trip.id };
}

/** `POST /api/(native/)trips { start, async: true }` → the start job (`result: { id }`). */
export function startTripJob(caller: StartCaller, start: TripStart, surface: 'site' | 'phone', steps?: StartSteps): TripJob {
  return startJob(caller.email, 'start', (handle) => runStart(caller, start, surface, handle, steps), { stages: START_STAGES });
}
