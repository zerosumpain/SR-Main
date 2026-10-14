// src/lib/trips/plan.server.ts
//
// Turning constraints into a stored plan version, and the phone's day
// changes into one. Every edit on the site lands here: the constraints have
// already changed, so this builds the travel matrix, solves, keeps the
// phone's version of a running day (the wire contract's conflict rule),
// routes the legs' lines and appends a version with its "what changed" list.
// Same input, same plan: an edit that changes nothing appends nothing.

import { solveTrip, replanDay, replanTrip } from '$lib/trips/solver';
import { bundleEtag, canonicalJson, dayMatrices, sha256, stayPoint, type TripBundle } from './bundle';
import { diffPlans, keepRunningDay, replaceDay } from './changes';
import type { LocalDate, Observation, PlannedDay, PlanSource, ReplanOption, SolvedPlan, TripAccess, TripEvent, TripReplanOption } from './model';
import { startGuidance, withGuidance } from './guidance.server';
import { jsonCall } from './llm.server';
import { planFullness, wireTravellers, withAlternatives } from './family';
import { NARRATIVE_SYSTEM, planSummary } from './prompt';
import { localDateIn, type RoutePoint } from './routing';
import { attachLegLines, buildStoredMatrix } from './routing.server';
import {
  addWishes,
  appendPlan,
  latestPhonePlan,
  latestPlan,
  listSuggestions,
  listTransport,
  suggestionWire,
  loadState,
  recentMessages,
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
export async function solverInput(trip: TripRecord, previous: StoredPlan | null, opts: { reuseMatrix?: boolean } = {}) {
  const [state, transport] = await Promise.all([loadState(trip.id), listTransport(trip.id)]);
  // Wishes with no place yet have no matrix point; the solver drops them with
  // a reason (a must with a warning), and the page says "needs a place".
  const placed = state.wishes.filter((w) => !w.suggested && !w.skipped && w.place);
  const points: RoutePoint[] = [
    ...state.stays.map((s) => ({ id: stayPoint(s.id), location: s.location })),
    ...placed.map((w) => ({ id: w.id, location: w.place!.location })),
    // v3: the airport or station at each end, so transfers are routed like any leg.
    ...transport.flatMap((t) => [
      ...(t.from.location ? [{ id: `transport:${t.id}:from`, location: t.from.location }] : []),
      ...(t.to.location ? [{ id: `transport:${t.id}:to`, location: t.to.location }] : []),
    ]),
  ];
  const samePoints =
    previous?.matrix && previous.matrix.points.length === points.length && previous.matrix.points.every((p, i) => p === points[i].id);
  const built =
    opts.reuseMatrix && samePoints && previous?.matrix
      ? { matrix: previous.matrix, notes: [] }
      : await buildStoredMatrix(points, trip);
  const input: SolverInput = {
    trip: { id: trip.id, timeZone: trip.timeZone, startDate: trip.startDate, endDate: trip.endDate, pace: trip.pace, modes: trip.modes, dayLoads: trip.dayLoads ?? {} },
    stays: state.stays,
    wishes: state.wishes,
    bookings: state.bookings,
    matrix: built.matrix,
    transport,
    // Stable re-plans: the solver changes as little as possible from the
    // latest stored plan. Every site re-solve comes through here — edits, the
    // conversation, "Re-plan now", ideas' dry runs, the phone's whole-trip
    // re-plan — so all of them keep unrelated days where they were.
    ...(previous ? { previous: previous.plan } : {}),
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
export async function replan(
  trip: TripRecord,
  source: PlanSource = 'site',
  opts: { keepRunningDay?: boolean } = {},
): Promise<{ plan: StoredPlan; created: boolean }> {
  const previous = await latestPlan(trip.id);
  const { input, state, routingNotes } = await solverInput(trip, previous);
  // The hash is of the CONSTRAINTS: `previous` is the stored plan itself, so
  // including it would make every re-solve look new and append a version.
  const { previous: _prev, ...constraints } = input;
  const inputHash = sha256(canonicalJson(constraints));
  if (previous && previous.inputHash === inputHash && source !== 'seed') return { plan: previous, created: false };

  let plan: SolvedPlan = solveTrip(input);
  const titles = titlesOf(state.wishes);
  const notes: string[] = [];

  // While a day is running, the phone's version of it wins.
  const today = runningDate(trip);
  if (today && previous && opts.keepRunningDay !== false) {
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
  // Guidance for today and the next day, in the background (cached per leg).
  startGuidance(trip.ownerEmail, trip.id);
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

/** The phone applied an option: a new version with those days replaced, nothing else touched. */
export async function storePhoneDays(trip: TripRecord, days: PlannedDay[]): Promise<StoredPlan | null> {
  const previous = await latestPlan(trip.id);
  if (!previous || !days.length) return null;
  const plan = days.reduce((p, d) => replaceDay(p, d), previous.plan);
  const { wishes } = await loadState(trip.id);
  const changes = diffPlans(previous.plan, plan, titlesOf(wishes))
    .filter((t) => t !== 'No change to the schedule.')
    .map((t) => `Changed on the phone — ${t}`);
  const stored = await appendPlan(trip.id, {
    source: 'phone',
    inputHash: `phone:${sha256(canonicalJson(days)).slice(0, 40)}`,
    plan,
    matrix: previous.matrix,
    changes: changes.length ? changes : ['Changed on the phone — times only.'],
  });
  startGuidance(trip.ownerEmail, trip.id);
  return stored;
}

/** One day: the v1 event shape. */
export const storePhoneDay = (trip: TripRecord, day: PlannedDay) => storePhoneDays(trip, [day]);

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
    if (e.kind === 'option-applied' && e.detail && typeof e.detail === 'object' && ('day' in e.detail || 'days' in e.detail)) {
      // A day option sends `detail.day`; a whole-trip option (v2) sends `detail.days`.
      const days = Array.isArray(e.detail.days) ? (e.detail.days as PlannedDay[]) : [e.detail.day as PlannedDay];
      const stored = await storePhoneDays(trip, days);
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

/**
 * Everything the phone needs for one trip, with its ETag: constraints, the
 * latest plan with each leg's guidance, per-day and whole-trip travel
 * matrices, the last 50 messages and the city guide. The ETag covers all of
 * it, so a new message or new guidance changes it.
 */
export async function tripBundle(trip: TripRecord, access: TripAccess = { canEdit: true, canApprove: true, canSuggest: true, role: 'creator' }): Promise<TripBundle> {
  const [state, latest, messages, transport, suggestions] = await Promise.all([
    loadState(trip.id),
    latestPlan(trip.id),
    recentMessages(trip.id, 50),
    listTransport(trip.id),
    listSuggestions(trip.id),
  ]);
  // Each leg carries its walk / public transport / taxi alternatives (v5).
  const plan = latest ? withAlternatives(await withGuidance(trip.id, latest.plan), latest.matrix) : null;
  const replaces = new Map(state.wishes.filter((w) => w.replacesMeal).map((w) => [w.id, w.replacesMeal as 'breakfast' | 'lunch' | 'dinner']));
  const body: Omit<TripBundle, 'etag'> = {
    trip: tripOnly(trip),
    stays: state.stays,
    wishes: state.wishes,
    bookings: state.bookings,
    plan: latest && plan ? { id: latest.id, version: latest.version, createdAt: latest.createdAt, plan, changes: latest.changes } : null,
    matrices: dayMatrices(latest?.matrix ?? null, latest?.plan ?? null),
    tripMatrix: latest?.matrix ?? null,
    messages,
    guide: trip.guide,
    transport,
    // Travellers only: no memory text on the wire, for anyone (v5).
    profile: trip.profile ? { travellers: wireTravellers(trip.profile) } : null,
    access,
    suggestions: suggestions.map(suggestionWire),
    fullness: latest ? planFullness(latest.plan, trip.pace, trip.dayLoads ?? {}, replaces) : {},
  };
  return { ...body, etag: bundleEtag(body) };
}

// ── Off the plan: the whole trip from now (v2) ─────────────────────────────

export interface TripReplanResult {
  tripOptions: TripReplanOption[];
  narrative: string;
  quickReplies: string[];
}

const KIND_TEXT: Record<Observation['kind'], string> = {
  behind: 'You look to be running behind the plan.',
  'off-route': 'You seem to have gone a different way from the plan.',
  'unplanned-stop': 'You have stopped somewhere that is not on the plan.',
  'out-of-order': 'You have reached a later stop first.',
  idle: 'You have stayed on past the planned time here.',
};

/** Words for the options when no model is reachable. */
export function fallbackNarrative(observation: Observation | null, options: TripReplanOption[]): string {
  const opening = observation ? KIND_TEXT[observation.kind] : 'Here is how the rest of the trip could go from now.';
  if (!options.length) return `${opening} The plan still works as it is.`;
  return `${opening} ${options.length === 1 ? 'One way forward' : `${options.length} ways forward`}: ${options.map((o) => o.label).join('; ')}.`;
}

/**
 * Whole-trip options from where the phone is (solver `replanTrip`, ≤3,
 * deterministic) and one planner call for the narrative. Nothing is stored
 * until the phone applies an option (`option-applied` with `detail.days`).
 */
export async function tripReplan(trip: TripRecord, body: ReplanBody & { observation: Observation | null }): Promise<TripReplanResult> {
  const previous = await latestPlan(trip.id);
  if (!previous) return { tripOptions: [], narrative: 'There is no plan yet to re-plan.', quickReplies: [] };
  const day = previous.plan.days.find((d) => d.date === body.date);
  if (!day) return { tripOptions: [], narrative: 'That day is not part of the plan.', quickReplies: [] };
  const { input, state } = await solverInput(trip, previous, { reuseMatrix: true });
  const tripOptions = replanTrip({
    ...input,
    day,
    nowMin: body.nowMin,
    position: body.position,
    atStopId: body.atStopId,
    doneStopIds: body.doneStopIds,
    observation: body.observation,
    plannedDays: previous.plan.days,
  });
  let narrative = fallbackNarrative(body.observation, tripOptions);
  let quickReplies: string[] = [];
  try {
    const raw = (await jsonCall(
      'trips-planner',
      [
        { role: 'system', content: NARRATIVE_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            city: trip.destination,
            observation: body.observation,
            nowMin: body.nowMin,
            today: planSummary({ ...previous.plan, days: [day], dropped: [], warnings: [] }, state.wishes),
            options: tripOptions.map((o) => ({ label: o.label, kind: o.kind, explanation: o.explanation, dropped: o.dropped.length, moved: o.moved.length })),
          }),
        },
      ],
      { maxTokens: 600, timeoutMs: 45_000 },
    )) as { narrative?: unknown; quickReplies?: unknown } | null;
    if (typeof raw?.narrative === 'string' && raw.narrative.trim()) narrative = raw.narrative.trim().slice(0, 800);
    if (Array.isArray(raw?.quickReplies)) {
      quickReplies = raw.quickReplies.filter((q): q is string => typeof q === 'string' && !!q.trim()).map((q) => q.trim().slice(0, 80)).slice(0, 3);
    }
  } catch (err) {
    console.warn('[trips] narrative unavailable, using the plain one:', (err as Error)?.message);
  }
  return { tripOptions, narrative, quickReplies };
}
