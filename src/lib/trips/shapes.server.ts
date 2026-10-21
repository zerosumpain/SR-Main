// src/lib/trips/shapes.server.ts
//
// v8: trip shapes, the I/O half (./shapes has the rules). ONE model call
// (the `trips-planner` workload; the router picks the model) chooses two or
// three themed selections from the research pack; each is dry-run as a whole
// on top of the trip's fixed items; near-identical ones are merged; each is
// stored as a `shape` proposal sharing one group. Accepting one is S1's
// (./proposals): it replays the stored ops and expires the other shapes.
//
// Called at the end of the guided start (./start.server) and by
// `POST …/proposals { kind: 'shapes' }`. Without a model it still offers two
// deterministic shapes (the famous, the quieter), solved the same way.

import { randomUUID } from 'node:crypto';
import { solveTrip } from '$lib/trips/solver';
import type { Proposal, Source } from './decisions';
import { addProposals, expireProposals, listPackPlaces, readPack, type NewProposal } from './decisions.store.server';
import { dryRun } from './dryrun';
import { jsonCall } from './llm.server';
import type { LocalDate } from './model';
import { replan, solverInput } from './plan.server';
import { travellersOnly } from './profile';
import { distinctShapes, fallbackShapes, leftOut, readShapes, shapeCandidates, shapeOps, shapeStops, shapeSummary, SHAPES_SYSTEM, shapesPrompt, type ShapeChoice } from './shapes';
import { datesBetween } from './solver/calendar';
import { latestPlan, listTransport, tripOnly, type TripRecord } from './store.server';
import { JobCancelled, startJob, type JobHandle, type TripJob } from './jobs.server';

export interface ShapesCaller {
  email: string;
  /** Only the owner's own request may use the owner's remembered preferences (server-side, in the prompt). */
  isOwner: boolean;
}

export interface ShapesDeps {
  model(system: string, user: string): Promise<unknown>;
}

const LIVE: ShapesDeps = {
  model: (system, user) => jsonCall('trips-planner', [{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens: 3000, timeoutMs: 120_000, temperature: 0.4 }),
};

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

/**
 * Draft, check and store two or three ways to do the trip. Returns the
 * stored proposals (one group), or [] when the pack has too little in it.
 * Earlier open shapes are replaced.
 */
export async function requestShapes(trip: TripRecord, caller: ShapesCaller, opts: { deps?: ShapesDeps; handle?: JobHandle | null } = {}): Promise<Proposal[]> {
  const deps = opts.deps ?? LIVE;
  const [places, pack, transport] = await Promise.all([listPackPlaces(trip.id), readPack(trip.id), listTransport(trip.id)]);
  const pool = shapeCandidates(places);
  if (pool.length < 4) return [];
  let latest = await latestPlan(trip.id);
  if (!latest) latest = (await replan(trip, 'site')).plan;
  const { input, state } = await solverInput(trip, latest, { reuseMatrix: true });
  const baseline = solveTrip(input);
  const dates: LocalDate[] = datesBetween(trip.startDate, trip.endDate);

  // What never moves: bookings with a time, locked stops, journeys.
  const fixed = [
    ...state.bookings.filter((b) => b.status === 'booked' && b.date).map((b) => ({ date: b.date!, text: `${b.title}${b.startMin !== null ? ` at ${hhmm(b.startMin)}` : ''} (booked)` })),
    ...state.wishes.filter((w) => !w.skipped && !w.suggested && w.fixedDate && (w.locked || w.fixedStartMin !== null)).map((w) => ({ date: w.fixedDate!, text: `${w.title}${w.fixedStartMin !== null ? ` at ${hhmm(w.fixedStartMin)}` : ''}` })),
    ...transport.map((t) => ({ date: t.direction === 'return' ? t.departDate : t.arriveDate, text: t.direction === 'return' ? `leave ${t.from.name} at ${hhmm(t.departMin)}` : `arrive ${t.to.name} at ${hhmm(t.arriveMin)}` })),
  ].filter((f) => dates.includes(f.date));
  const profile = caller.isOwner ? trip.profile : travellersOnly(trip.profile);
  const travellers = (profile?.travellers ?? []).map((t) => (t.age != null && t.age < 18 ? `${t.name} (${t.age})` : t.name)).join(', ') || null;

  let choices: ShapeChoice[] = [];
  try {
    const raw = await deps.model(SHAPES_SYSTEM, shapesPrompt({ trip, dates, travellers, preferences: [...(trip.notes ? [trip.notes] : []), ...(profile?.preferences ?? []).map((p) => p.text)], fixed, places: pool, calendar: pack.calendar }));
    choices = readShapes(raw, new Set(pool.map((p) => p.id)), dates);
  } catch (err) {
    console.warn('[trips/shapes] no model for shapes, offering the plain two:', (err as Error)?.message);
  }
  if (choices.length < 2) choices = fallbackShapes(places, dates);
  if (opts.handle && (await opts.handle.cancelled())) throw new JobCancelled();

  const base = { input, ctx: { trip: tripOnly(trip), stays: state.stays, wishes: state.wishes, bookings: state.bookings, transport, profile: trip.profile } };
  const titles = Object.fromEntries(state.wishes.map((w) => [w.id, w.title]));
  const byOsm = new Map(places.filter((p) => p.place.osmId).map((p) => [p.place.osmId!, p]));
  const solved = [];
  for (const c of choices) {
    const ops = shapeOps(c, places, state.wishes);
    if (!ops.length) continue;
    const r = await dryRun(base, ops, { trustsPlaces: true, baseline, titles, factsFor: (p) => (p.osmId ? (byOsm.get(p.osmId)?.facts ?? null) : null) });
    if (!r.applied.length) continue;
    solved.push({ choice: c, r });
  }
  const keep = distinctShapes(solved.map((s) => shapeStops(s.r.plan)));
  const groupId = `shapes:${randomUUID().slice(0, 8)}`;
  const proposals: NewProposal[] = keep.map((i) => {
    const { choice, r } = solved[i];
    const chosen = choice.placeIds.map((id) => places.find((p) => p.id === id)).filter((p): p is (typeof places)[number] => !!p);
    const evidence: Source[] = chosen.flatMap((p) => p.sources.filter((s) => !/openstreetmap|wikidata/.test(s.url))).filter((s, n, a) => a.findIndex((x) => x.url === s.url) === n).slice(0, 6);
    const kids = chosen.map((p) => p.kidFriendly);
    const dropped = r.plan.dropped.map((d) => r.input.wishes.find((w) => w.id === d.wishId)?.title).filter((t): t is string => !!t);
    return {
      groupId,
      kind: 'shape',
      title: choice.headline,
      why: choice.why,
      scope: { date: null, stage: null, stopId: null, wishId: null },
      ops: r.applied,
      diff: r.diff,
      tradeoffs: {
        fits: r.tradeoffs.fits,
        fitText: null,
        walkMin: r.tradeoffs.walkMin,
        walkKmPerDay: r.tradeoffs.walkKmPerDay,
        earlyStarts: r.tradeoffs.earlyStarts,
        toBook: r.tradeoffs.toBook,
        costText: null,
        indoor: null,
        kidFriendly: kids.length && kids.every((k) => k === true) ? true : kids.some((k) => k === false) ? false : null,
        lessVisited: chosen.some((p) => p.lessVisited),
        pushesOut: r.tradeoffs.pushesOut,
        moves: r.tradeoffs.moves,
      },
      evidence,
      place: null,
      image: chosen.find((p) => p.image)?.image ?? null,
      packPlaceId: null,
      shape: shapeSummary(choice.headline, r.plan, leftOut(choice, places, dropped)),
      preview: r.preview,
      basedOnVersion: latest!.version,
    };
  });
  if (proposals.length < 2) return [];
  await expireProposals(trip.id, ['shape'], 'Replaced by new ways to do it');
  return addProposals(trip.id, proposals, caller.email);
}

/** `POST proposals { kind: 'shapes', async: true }` (S1's route): the same as a job with one stage. */
export function startShapesJob(trip: TripRecord, caller: ShapesCaller, deps?: ShapesDeps): TripJob {
  return startJob(
    caller.email,
    'shapes',
    async (handle) => {
      handle.stage('shapes', 'running');
      const proposals = await requestShapes(trip, caller, { deps, handle });
      handle.stage('shapes', 'done', proposals.length ? `${proposals.length} ways to do it` : 'Not enough in the research yet');
      return { proposals };
    },
    { tripId: trip.id, stages: [{ key: 'shapes', label: 'Drafting ways to do it' }] },
  );
}
