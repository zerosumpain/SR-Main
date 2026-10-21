// src/lib/trips/dryrun.ts
//
// v8: "what would this change do?" — apply any list of ops to an in-memory
// copy of the trip, solve, and compare with the trip as it stands. Nothing is
// stored. It generalises the one-wish check ideas and options use
// (./ideas `verifyIdea`) to whole change-sets: a proposal (swap two days, a
// lighter Thursday, a whole trip shape) and every answer of a question are
// checked through here before anyone sees them.
//
// The same validation as a real turn (./ops `applyOps`) with side effects
// that only touch the copy. A new place gets estimated travel times to every
// other point (./ideas `withPoint`), as an idea's dry run does; the real
// matrix is built when the change is accepted.
//
// PURE apart from `resolvePlace`, which the caller supplies (OpenStreetMap on
// the server, a table in tests, nothing for pack places that already have one).

import { solveTrip, type SolverInput } from '$lib/trips/solver';
import { diffPlans } from './changes';
import { withPoint } from './ideas';
import type { Booking, LatLng, LocalDate, PlannedDay, SolvedPlan, Stay, TransportSegment, TravelMatrix, Trip, TripOp, Wish } from './model';
import { applyOps, type OpContext, type OpEffects, type PlacedResult } from './ops';
import type { PlanChange, PlanDiff, ProposalTradeoffs } from './decisions';

export interface DryRunOptions {
  /** Looks a placeQuery up; null = cannot place it (the op is rejected). */
  resolvePlace?: (query: string, near: LatLng | null) => Promise<PlacedResult | null>;
  /** Ops may carry a place already found (pack places, a checked proposal being replayed). Never for a model's raw ops. */
  trustsPlaces?: boolean;
  /** Facts to attach to a new wish at a place (the pack's opening hours), so hours count in the check. */
  factsFor?: (place: PlacedResult) => Wish['facts'];
  /** The plan the diff is against; default: the same input solved without the change. */
  baseline?: SolvedPlan;
  /** Titles for the diff lines (existing wishes); new wishes add their own. */
  titles?: Record<string, string>;
  knownUrls?: Set<string>;
}

export interface DryRunResult {
  /** True when every op applied. */
  ok: boolean;
  /**
   * The ops as applied, with any place a query resolved to written into the
   * op — what accepting the change replays (with `trustsPlaces`), so the
   * accepted change is exactly the checked one.
   */
  applied: TripOp[];
  rejected: Array<{ op: TripOp; reason: string }>;
  /** True when a constraint changed (a no-op change-set is not a proposal). */
  changed: boolean;
  baseline: SolvedPlan;
  plan: SolvedPlan;
  diff: PlanDiff;
  /** The days that differ, as solved — the ghost drawn on the map. */
  preview: PlannedDay[];
  tradeoffs: Pick<ProposalTradeoffs, 'fits' | 'walkMin' | 'walkKmPerDay' | 'earlyStarts' | 'toBook' | 'pushesOut' | 'moves'>;
  /** The changed trip's solver input, for chaining a second check. */
  input: SolverInput;
  /** Ids the copy gave new rows, in the order they were made. */
  created: { stays: string[]; wishes: string[]; bookings: string[]; transport: string[] };
}

type Base = { input: SolverInput; ctx: Omit<OpContext, 'knownUrls'> & { knownUrls?: Set<string> } };

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Every point the matrix should hold for these constraints, with where it is. */
function pointsOf(stays: Stay[], wishes: Wish[], transport: TransportSegment[]): Map<string, LatLng> {
  const out = new Map<string, LatLng>();
  for (const s of stays) out.set(`stay:${s.id}`, s.location);
  for (const w of wishes) if (w.place && !w.suggested && !w.skipped) out.set(w.id, w.place.location);
  for (const t of transport) {
    if (t.from.location) out.set(`transport:${t.id}:from`, t.from.location);
    if (t.to.location) out.set(`transport:${t.id}:to`, t.to.location);
  }
  return out;
}

/** The base matrix with an estimated row and column for every point it lacks. */
export function matrixFor(base: TravelMatrix, points: Map<string, LatLng>, known: Map<string, LatLng>): TravelMatrix {
  let m = base;
  const locations = new Map([...known, ...points]);
  for (const [id, at] of points) {
    if (m.points.includes(id)) continue;
    m = withPoint(m, id, at, locations);
  }
  return m;
}

/**
 * Apply `ops` to a copy of `base` and solve. Never throws for a bad op (it is
 * in `rejected`); a solver fault does propagate.
 */
export async function dryRun(base: Base, ops: unknown[], opts: DryRunOptions = {}): Promise<DryRunResult> {
  const ctx: OpContext = {
    trip: clone(base.ctx.trip),
    stays: clone(base.ctx.stays),
    wishes: clone(base.ctx.wishes),
    bookings: clone(base.ctx.bookings),
    transport: clone(base.ctx.transport ?? []),
    profile: clone(base.ctx.profile ?? null),
    knownUrls: opts.knownUrls ?? base.ctx.knownUrls ?? new Set(),
  };
  const created = { stays: [] as string[], wishes: [] as string[], bookings: [] as string[], transport: [] as string[] };
  /** The place each addWish resolved to, in order, to write back into the applied ops. */
  const wishPlaces: Array<Wish['place']> = [];
  let n = 0;
  const id = (kind: string) => `dry-${kind}-${++n}`;

  const fx: OpEffects = {
    trustsPlaces: opts.trustsPlaces === true,
    resolvePlace: async (query, near) => (opts.resolvePlace ? opts.resolvePlace(query, near) : null),
    setTrip: async () => {},
    addStay: async (f) => {
      const stay: Stay = { id: id('stay'), name: f.name, address: f.address, location: f.location, fromDate: f.fromDate, toDate: f.toDate, checkInMin: f.checkInMin, checkOutMin: f.checkOutMin };
      created.stays.push(stay.id);
      return stay;
    },
    updateStay: async () => {},
    removeStay: async () => {},
    addWish: async (f) => {
      const wish: Wish = {
        id: id('wish'),
        title: f.title,
        place: f.place,
        priority: f.priority,
        durationSec: f.durationSec,
        partOfDay: f.partOfDay,
        fixedDate: f.fixedDate,
        fixedStartMin: f.fixedStartMin,
        locked: f.fixedStartMin !== null,
        suggested: false,
        skipped: false,
        facts: f.place && opts.factsFor ? opts.factsFor(f.place) : null,
        note: f.note,
        sortHint: 0,
        replacesMeal: f.replacesMeal ?? null,
      };
      created.wishes.push(wish.id);
      wishPlaces.push(f.place);
      return wish;
    },
    updateWish: async () => {},
    removeWish: async () => {},
    addBooking: async (b) => {
      const booking: Booking = {
        id: id('booking'),
        wishId: b.wishId,
        title: b.title,
        date: b.date ?? null,
        startMin: b.startMin ?? null,
        endMin: b.endMin ?? null,
        reference: b.reference ?? null,
        url: b.url ?? null,
        documentId: null,
        status: b.status ?? 'to-book',
      };
      created.bookings.push(booking.id);
      return booking;
    },
    updateBooking: async () => {},
    addTransport: async (s) => {
      const seg: TransportSegment = { ...s, id: id('transport') };
      created.transport.push(seg.id);
      return seg;
    },
    updateTransport: async () => {},
    removeTransport: async () => {},
    // Memory and the profile are never touched by a dry run.
    remember: async () => ({ stored: false }),
    saveProfile: async () => {},
  };

  const result = await applyOps(ops, ctx, fx);

  // Write each resolved place back into its addWish op, so replaying the
  // checked ops (trusting places) adds exactly what was checked.
  let w = 0;
  const applied = result.applied.map((op) => {
    if (op.op !== 'addWish') return op;
    const place = wishPlaces[w++];
    return place ? ({ ...op, wish: { ...op.wish, place } } as TripOp) : op;
  });

  const known = pointsOf(base.input.stays, base.input.wishes, base.input.transport ?? []);
  const points = pointsOf(ctx.stays, ctx.wishes, ctx.transport ?? []);
  const matrix = matrixFor(base.input.matrix, points, known);
  const trip: Trip = ctx.trip;
  const input: SolverInput = {
    ...base.input,
    trip: {
      ...base.input.trip,
      timeZone: trip.timeZone,
      startDate: trip.startDate,
      endDate: trip.endDate,
      pace: trip.pace,
      modes: trip.modes,
      dayLoads: trip.dayLoads ?? {},
    },
    stays: ctx.stays,
    wishes: ctx.wishes,
    bookings: ctx.bookings,
    transport: ctx.transport ?? [],
    matrix,
  };
  const baseline = opts.baseline ?? solveTrip(base.input);
  const plan = result.changed ? solveTrip(input) : baseline;
  const titles: Record<string, string> = { ...(opts.titles ?? {}) };
  for (const x of [...base.input.wishes, ...ctx.wishes]) titles[x.id] ??= x.title;
  const diff = planDiff(baseline, plan, titles);
  return {
    ok: result.rejected.length === 0,
    applied,
    rejected: result.rejected,
    changed: result.changed,
    baseline,
    plan,
    diff,
    preview: plan.days.filter((d) => diff.dates.includes(d.date)),
    tradeoffs: tradeoffsOf(baseline, plan, input, titles),
    input,
    created,
  };
}

// ── The structured difference ──────────────────────────────────────────────

function wishStops(plan: SolvedPlan): Map<string, { date: LocalDate; arriveMin: number; title: string }> {
  const out = new Map<string, { date: LocalDate; arriveMin: number; title: string }>();
  for (const day of plan.days) for (const s of day.stops) if (s.kind === 'wish' && s.wishId) out.set(s.wishId, { date: day.date, arriveMin: s.arriveMin, title: s.title });
  return out;
}

/** Metres walked across a plan (legs with a distance only). */
export function walkedMetres(plan: SolvedPlan): number | null {
  let total = 0;
  let any = false;
  for (const d of plan.days)
    for (const l of d.legs) {
      if (l.mode !== 'walk' || l.distanceM === null) continue;
      total += l.distanceM;
      any = true;
    }
  return any ? total : null;
}

/** Days whose stops differ in order, timing (≥ 15 min) or content. */
function changedDates(prev: SolvedPlan, next: SolvedPlan): LocalDate[] {
  const key = (d: PlannedDay | undefined) =>
    d ? d.stops.map((s) => `${s.wishId ?? s.id}@${Math.round(s.arriveMin / 15)}`).join('|') : '';
  const dates = new Set<LocalDate>([...prev.days.map((d) => d.date), ...next.days.map((d) => d.date)]);
  return [...dates].filter((date) => key(prev.days.find((d) => d.date === date)) !== key(next.days.find((d) => d.date === date))).sort();
}

/** "What changed", structured for before → after, plus the plain lines. */
export function planDiff(prev: SolvedPlan | null, next: SolvedPlan, titles: Record<string, string> = {}): PlanDiff {
  if (!prev) return { lines: ['First plan.'], changes: [], dates: next.days.map((d) => d.date), walkDeltaM: null, dropped: [] };
  const before = wishStops(prev);
  const after = wishStops(next);
  const name = (id: string, fallback: string) => titles[id] ?? fallback;
  const changes: PlanChange[] = [];
  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b) changes.push({ kind: 'added', wishId: id, title: name(id, a.title), date: a.date, fromDate: null, fromMin: null, toMin: a.arriveMin, reason: null });
    else if (b.date !== a.date) changes.push({ kind: 'moved', wishId: id, title: name(id, a.title), date: a.date, fromDate: b.date, fromMin: b.arriveMin, toMin: a.arriveMin, reason: null });
    else if (Math.abs(b.arriveMin - a.arriveMin) >= 15) changes.push({ kind: 'retimed', wishId: id, title: name(id, a.title), date: a.date, fromDate: b.date, fromMin: b.arriveMin, toMin: a.arriveMin, reason: null });
  }
  const droppedBefore = new Set(prev.dropped.map((d) => d.wishId));
  for (const [id, b] of before) {
    if (after.has(id)) continue;
    const dropped = next.dropped.find((d) => d.wishId === id);
    changes.push({ kind: dropped ? 'dropped' : 'removed', wishId: id, title: name(id, b.title), date: null, fromDate: b.date, fromMin: b.arriveMin, toMin: null, reason: dropped?.reason ?? null });
  }
  changes.sort((x, y) => ((x.date ?? x.fromDate ?? '') + x.title < (y.date ?? y.fromDate ?? '') + y.title ? -1 : 1));
  const wb = walkedMetres(prev);
  const wa = walkedMetres(next);
  return {
    lines: diffPlans(prev, next, titles),
    changes,
    dates: changedDates(prev, next),
    walkDeltaM: wb !== null && wa !== null ? Math.round(wa - wb) : null,
    dropped: next.dropped.filter((d) => !droppedBefore.has(d.wishId)).map((d) => titles[d.wishId] ?? d.wishId),
  };
}

/** The solver-measurable trade-offs of a change; the rest (cost, indoor…) comes from the place. */
export function tradeoffsOf(prev: SolvedPlan, next: SolvedPlan, input: SolverInput, titles: Record<string, string>): DryRunResult['tradeoffs'] {
  const wb = walkedMetres(prev);
  const wa = walkedMetres(next);
  const walkSec = (p: SolvedPlan) => p.days.reduce((t, d) => t + d.legs.filter((l) => l.mode === 'walk').reduce((s, l) => s + l.durationSec, 0), 0);
  const before = new Map(prev.days.flatMap((d) => d.stops.filter((s) => s.wishId).map((s) => [s.wishId as string, d.date] as const)));
  const moves = next.days.flatMap((d) =>
    d.stops
      .filter((s) => s.wishId && before.has(s.wishId) && before.get(s.wishId) !== d.date)
      .map((s) => ({ title: titles[s.wishId as string] ?? s.title, from: before.get(s.wishId as string)!, to: d.date })),
  );
  const was = new Set(prev.dropped.map((d) => d.wishId));
  const pushesOut = next.dropped.filter((d) => !was.has(d.wishId) && titles[d.wishId] !== undefined && prev.days.some((day) => day.stops.some((s) => s.wishId === d.wishId))).map((d) => titles[d.wishId]);
  const toBook = input.wishes.filter((w) => !w.suggested && !w.skipped && w.facts?.bookingRequired && !input.bookings.some((b) => b.wishId === w.id && b.status === 'booked')).length;
  const days = next.days.length || 1;
  return {
    fits: pushesOut.length === 0,
    walkMin: Math.round((walkSec(next) - walkSec(prev)) / 60),
    walkKmPerDay: wa !== null ? Math.round((wa / days / 1000) * 10) / 10 : wb !== null ? Math.round((wb / days / 1000) * 10) / 10 : null,
    earlyStarts: next.days.filter((d) => {
      const first = d.stops.find((s) => s.kind !== 'stay');
      return first ? first.arriveMin < 9 * 60 : false;
    }).length,
    toBook,
    pushesOut,
    moves,
  };
}
