// src/lib/trips/plan.server.ts
//
// Turning constraints into a stored plan version, and the phone's day
// changes into one. Every edit on the site lands here: the constraints have
// already changed, so this builds the travel matrix, solves, keeps the
// phone's version of a running day (the wire contract's conflict rule),
// routes the legs' lines and appends a version with its "what changed" list.
// Same input, same plan: an edit that changes nothing appends nothing.

import { solveTrip, replanDay } from '$lib/trips/solver';
import { bundleEtag, canonicalJson, dayMatrices, sha256, stayPoint, type TripBundle } from './bundle';
import { diffPlans, keepRunningDay, replaceDay } from './changes';
import type { LocalDate, PlannedDay, PlanSource, ReplanOption, SolvedPlan, TripEvent } from './model';
import { localDateIn, type RoutePoint } from './routing';
import { attachLegLines, buildStoredMatrix } from './routing.server';
import {
  addWishes,
  appendPlan,
  latestPhonePlan,
  latestPlan,
  loadState,
  recordEvents,
  setEventPlanVersion,
  tripOnly,
  updateTrip,
  updateWish,
  type StoredPlan,
  type TripRecord,
} from './store.server';
import type { ReplanBody } from './intake';

type SolverInput = Parameters<typeof solveTrip>[0];

function titlesOf(wishes: Array<{ id: string; title: string }>): Record<string, string> {
  return Object.fromEntries(wishes.map((w) => [w.id, w.title]));
}

/** The solver's input for a trip as it stands, plus the wishes left out for want of a place. */
async function solverInput(trip: TripRecord, previous: StoredPlan | null, opts: { reuseMatrix?: boolean } = {}) {
  const state = await loadState(trip.id);
  // Wishes with no place yet have no matrix point; the solver drops them with
  // a reason (a must with a warning), and the page says "needs a place".
  const placed = state.wishes.filter((w) => !w.suggested && !w.skipped && w.place);
  const points: RoutePoint[] = [
    ...state.stays.map((s) => ({ id: stayPoint(s.id), location: s.location })),
    ...placed.map((w) => ({ id: w.id, location: w.place!.location })),
  ];
  const samePoints =
    previous?.matrix && previous.matrix.points.length === points.length && previous.matrix.points.every((p, i) => p === points[i].id);
  const built =
    opts.reuseMatrix && samePoints && previous?.matrix
      ? { matrix: previous.matrix, notes: [] }
      : await buildStoredMatrix(points, trip);
  const input: SolverInput = {
    trip: { id: trip.id, timeZone: trip.timeZone, startDate: trip.startDate, endDate: trip.endDate, pace: trip.pace, modes: trip.modes },
    stays: state.stays,
    wishes: state.wishes,
    bookings: state.bookings,
    matrix: built.matrix,
  };
  return { input, state, routingNotes: built.notes };
}

/** The date in the trip's zone right now, when the trip is under way. */
export function runningDate(trip: Pick<TripRecord, 'timeZone' | 'startDate' | 'endDate'>, now = new Date()): LocalDate | null {
  const today = localDateIn(trip.timeZone, now);
  return today >= trip.startDate && today <= trip.endDate ? today : null;
}

/**
 * Solve the trip and append a version unless nothing changed. Returns the
 * newest version either way, and whether this call wrote it.
 */
export async function replan(trip: TripRecord, source: PlanSource = 'site'): Promise<{ plan: StoredPlan; created: boolean }> {
  const previous = await latestPlan(trip.id);
  const { input, state, routingNotes } = await solverInput(trip, previous);
  const inputHash = sha256(canonicalJson(input));
  if (previous && previous.inputHash === inputHash && source !== 'seed') return { plan: previous, created: false };

  let plan: SolvedPlan = solveTrip(input);
  const titles = titlesOf(state.wishes);
  const notes: string[] = [];

  // While a day is running, the phone's version of it wins.
  const today = runningDate(trip);
  if (today && previous) {
    const phone = await latestPhonePlan(trip.id);
    if (phone && localDateIn(trip.timeZone, new Date(phone.createdAt)) === today) {
      const kept = keepRunningDay(plan, previous.plan, today, titles);
      plan = kept.plan;
      notes.push(...kept.notes);
    }
  }

  plan = await attachLegLines(plan, previous?.plan ?? null, trip);
  const changes = [...diffPlans(previous?.plan ?? null, plan, titles), ...notes];
  if (routingNotes.some((n) => /estimated/.test(n))) changes.push(`Travel times: ${routingNotes.join('; ')}.`);
  const stored = await appendPlan(trip.id, { source, inputHash, plan, matrix: input.matrix, changes });
  return { plan: stored, created: true };
}

/** Server-side "re-plan the rest of today" for the phone: up to three options, nothing stored. */
export async function replanOptions(trip: TripRecord, body: ReplanBody): Promise<ReplanOption[]> {
  const previous = await latestPlan(trip.id);
  if (!previous) return [];
  const day = previous.plan.days.find((d) => d.date === body.date);
  if (!day) return [];
  // The stored matrix: the figures the phone also holds (never Mapbox — see routing.server).
  const { input } = await solverInput(trip, previous, { reuseMatrix: true });
  return replanDay({
    ...input,
    day,
    nowMin: body.nowMin,
    position: body.position,
    atStopId: body.atStopId,
    doneStopIds: body.doneStopIds,
  });
}

/** The phone applied an option: a new version with that day replaced, nothing else touched. */
export async function storePhoneDay(trip: TripRecord, day: PlannedDay): Promise<StoredPlan | null> {
  const previous = await latestPlan(trip.id);
  if (!previous) return null;
  const plan = replaceDay(previous.plan, day);
  const { wishes } = await loadState(trip.id);
  const changes = diffPlans(previous.plan, plan, titlesOf(wishes))
    .filter((t) => t !== 'No change to the schedule.')
    .map((t) => `Changed on the phone — ${t}`);
  return appendPlan(trip.id, {
    source: 'phone',
    inputHash: `phone:${sha256(canonicalJson(day)).slice(0, 40)}`,
    plan,
    matrix: previous.matrix,
    changes: changes.length ? changes : ['Changed on the phone — times only.'],
  });
}

/**
 * The phone's events: recorded once each (idempotent on clientId), then
 * applied — an applied option stores a phone version for that day, a skip
 * marks the wish skipped, an added stop becomes a wish pinned to that day.
 * Every clientId sent is accepted, new or repeated.
 */
export async function applyEvents(trip: TripRecord, events: TripEvent[]): Promise<{ accepted: string[]; planVersion: number }> {
  const fresh = await recordEvents(trip.id, events);
  for (const e of events) {
    if (!fresh.has(e.clientId)) continue;
    if (e.kind === 'option-applied' && e.detail && typeof e.detail === 'object' && 'day' in e.detail) {
      const stored = await storePhoneDay(trip, e.detail.day as PlannedDay);
      if (stored) await setEventPlanVersion(trip.id, e.clientId, stored.version);
    } else if (e.kind === 'skipped' && e.wishId) {
      await updateWish(trip.id, e.wishId, { skipped: true });
    } else if (e.kind === 'stop-added' && e.detail) {
      const d = e.detail as Record<string, unknown>;
      const loc = d.location as { lat?: unknown; lng?: unknown } | undefined;
      const lat = Number(loc?.lat);
      const lng = Number(loc?.lng);
      const title = String(d.title).slice(0, 160);
      await addWishes(trip.id, [
        {
          title,
          priority: 'nice',
          durationSec: Number.isFinite(Number(d.durationSec)) ? Math.round(Number(d.durationSec)) : null,
          partOfDay: 'any',
          fixedDate: localDateIn(trip.timeZone, new Date(e.at)),
          fixedStartMin: null,
          note: 'Added on the phone.',
          place: Number.isFinite(lat) && Number.isFinite(lng) ? { name: title, location: { lat, lng }, osmId: null, address: null } : null,
        },
      ]);
    }
  }
  if (fresh.size && trip.status === 'planned') await updateTrip(trip.id, { status: 'active' });
  const latest = await latestPlan(trip.id);
  return { accepted: events.map((e) => e.clientId), planVersion: latest?.version ?? 0 };
}

/** Everything the phone needs for one trip, with its ETag. */
export async function tripBundle(trip: TripRecord): Promise<TripBundle> {
  const [state, latest] = await Promise.all([loadState(trip.id), latestPlan(trip.id)]);
  const body: Omit<TripBundle, 'etag'> = {
    trip: tripOnly(trip),
    stays: state.stays,
    wishes: state.wishes,
    bookings: state.bookings,
    plan: latest ? { id: latest.id, version: latest.version, createdAt: latest.createdAt, plan: latest.plan, changes: latest.changes } : null,
    matrices: dayMatrices(latest?.matrix ?? null, latest?.plan ?? null),
  };
  return { ...body, etag: bundleEtag(body) };
}
