// src/lib/trips/store.server.ts
//
// Drizzle access for the trip planner: trips, stays, wishes, bookings, the
// append-only plan versions and the phone's events (idempotent on clientId).
// Rows are mapped to the shared shapes in ./model at this boundary, so nothing
// above here sees a database row. Every read takes the owner's email: a trip
// that is not theirs reads as missing.

import { and, asc, desc, eq, inArray, isNull, max, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { trip, tripBooking, tripEvent, tripJob, tripMessage, tripPlace, tripPlan, tripProposal, tripQuestion, tripStay, tripSuggestion, tripTransport, tripWish } from '$lib/db/schema';
import type {
  Booking,
  Facts,
  Pace,
  PlanSource,
  PlanVersion,
  SolvedPlan,
  Stay,
  TravelMatrix,
  TravelMode,
  StopGuide,
  Trip,
  TripEvent,
  TripGuide,
  TripMessage,
  TripOp,
  TransportSegment,
  TravellerProfile,
  ResearchStep,
  TripSuggestion,
  SuggestionStatus,
  DayStage,
  WishDraft,
  TripStatus,
  Wish,
} from './model';
import type { TripSummary } from './bundle';
import type { BookingPatch, StayInput, TripInput, WishInput, WishPatch } from './intake';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | null | undefined): v is string => !!v && UUID.test(v);

type TripRow = typeof trip.$inferSelect;
type StayRow = typeof tripStay.$inferSelect;
type WishRow = typeof tripWish.$inferSelect;
type BookingRow = typeof tripBooking.$inferSelect;
type PlanRow = typeof tripPlan.$inferSelect;

export interface ResearchState {
  state: 'running' | 'done' | 'failed';
  depth: 'brief' | 'deep';
  total: number;
  done: number;
  current: string | null;
  startedAt: string;
  finishedAt: string | null;
  note: string | null;
}

export interface TripRecord extends Trip {
  research: ResearchState | null;
  guide: TripGuide | null;
  profile: TravellerProfile | null;
  updatedAt: string;
}

export function toTrip(r: TripRow): TripRecord {
  return {
    id: r.id,
    ownerEmail: r.ownerEmail,
    title: r.title,
    destination: r.destination,
    timeZone: r.timeZone,
    startDate: r.startDate,
    endDate: r.endDate,
    pace: r.pace as Pace,
    modes: (r.modes ?? ['walk']) as TravelMode[],
    status: r.status as TripStatus,
    notes: r.notes,
    dayLoads: (r.dayLoads as Trip['dayLoads']) ?? {},
    research: (r.research as ResearchState | null) ?? null,
    guide: (r.guide as unknown as TripGuide | null) ?? null,
    profile: (r.profile as unknown as TravellerProfile | null) ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** The wire shape of a trip: model fields only. */
export function tripOnly(t: TripRecord): Trip {
  const { research: _r, updatedAt: _u, guide: _g, profile: _p, ...rest } = t;
  return rest;
}

function toStay(r: StayRow): Stay {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    location: { lat: r.lat, lng: r.lng },
    fromDate: r.fromDate,
    toDate: r.toDate,
    checkInMin: r.checkInMin,
    checkOutMin: r.checkOutMin,
  };
}

function toWish(r: WishRow): Wish {
  return {
    id: r.id,
    title: r.title,
    place: (r.place as Wish['place']) ?? null,
    priority: r.priority as Wish['priority'],
    durationSec: r.durationSec,
    partOfDay: r.partOfDay as Wish['partOfDay'],
    fixedDate: r.fixedDate,
    fixedStartMin: r.fixedStartMin,
    locked: r.locked,
    suggested: r.suggested,
    skipped: r.skipped,
    facts: (r.facts as Facts | null) ?? null,
    note: r.note,
    sortHint: r.sortHint,
    replacesMeal: (r.replacesMeal as Wish['replacesMeal']) ?? null,
    guide: (r.guide as unknown as StopGuide | null) ?? null,
  };
}

function toBooking(r: BookingRow): Booking {
  return {
    id: r.id,
    wishId: r.wishId,
    title: r.title,
    date: r.date,
    startMin: r.startMin,
    endMin: r.endMin,
    reference: r.reference,
    url: r.url,
    documentId: r.documentId,
    status: r.status as Booking['status'],
  };
}

export interface StoredPlan extends PlanVersion {
  matrix: TravelMatrix | null;
}

function toPlan(r: PlanRow): StoredPlan {
  return {
    id: r.id,
    tripId: r.tripId,
    version: r.version,
    source: r.source as PlanSource,
    createdAt: r.createdAt.toISOString(),
    inputHash: r.inputHash,
    plan: r.plan as unknown as SolvedPlan,
    changes: r.changes ?? [],
    matrix: (r.matrix as unknown as TravelMatrix | null) ?? null,
  };
}

// ── Trips ──────────────────────────────────────────────────────────────────

/**
 * The trips a caller may see. v5: trips are open to the whole family, so this
 * is every trip; the caller's rights on each are decided by `tripAccess`.
 * (`_viewer` stays in the signature: every caller has already been checked as
 * the owner or a family member.)
 */
export async function listTrips(_viewer: string): Promise<TripSummary[]> {
  return listAllTrips();
}

/** v5: every trip, for the family's phone lane (trips are open to the whole family). */
export async function listAllTrips(): Promise<TripSummary[]> {
  const rows = await db
    .select({ t: trip, version: max(tripPlan.version) })
    .from(trip)
    .leftJoin(tripPlan, eq(tripPlan.tripId, trip.id))
    .groupBy(trip.id)
    .orderBy(desc(trip.startDate), asc(trip.title));
  return rows.map(({ t, version }) => ({
    id: t.id,
    title: t.title,
    destination: t.destination,
    timeZone: t.timeZone,
    startDate: t.startDate,
    endDate: t.endDate,
    status: t.status as TripStatus,
    planVersion: version ?? null,
    updatedAt: t.updatedAt.toISOString(),
  }));
}

/** v5: a trip by id, whoever created it (the caller's access is decided by `tripAccess`). */
export async function getTripById(id: string): Promise<TripRecord | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(trip).where(eq(trip.id, id)).limit(1);
  return row ? toTrip(row) : null;
}

/** A trip by id for a caller already checked as the owner or family (v5: trips are open to the family). */
export async function getTrip(_viewer: string, id: string): Promise<TripRecord | null> {
  return getTripById(id);
}

export async function createTrip(owner: string, input: TripInput): Promise<TripRecord> {
  const [row] = await db
    .insert(trip)
    .values({ ownerEmail: owner, ...input })
    .returning();
  return toTrip(row);
}

export async function updateTrip(id: string, input: Partial<TripInput> & { status?: TripStatus }): Promise<void> {
  await db.update(trip).set({ ...input, updatedAt: new Date() }).where(eq(trip.id, id));
}

export async function touchTrip(id: string): Promise<void> {
  await db.update(trip).set({ updatedAt: new Date() }).where(eq(trip.id, id));
}

export async function deleteTrip(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(tripEvent).where(eq(tripEvent.tripId, id));
    // v8: the planner's decisions, the research pack and the trip's jobs.
    await tx.delete(tripProposal).where(eq(tripProposal.tripId, id));
    await tx.delete(tripQuestion).where(eq(tripQuestion.tripId, id));
    await tx.delete(tripPlace).where(eq(tripPlace.tripId, id));
    await tx.delete(tripJob).where(eq(tripJob.tripId, id));
    await tx.delete(tripMessage).where(eq(tripMessage.tripId, id));
    await tx.delete(tripTransport).where(eq(tripTransport.tripId, id));
    await tx.delete(tripSuggestion).where(eq(tripSuggestion.tripId, id));
    await tx.delete(tripPlan).where(eq(tripPlan.tripId, id));
    await tx.delete(tripBooking).where(eq(tripBooking.tripId, id));
    await tx.delete(tripWish).where(eq(tripWish.tripId, id));
    await tx.delete(tripStay).where(eq(tripStay.tripId, id));
    await tx.delete(trip).where(eq(trip.id, id));
  });
}

export async function setResearch(id: string, state: ResearchState | null): Promise<void> {
  await db.update(trip).set({ research: state as unknown as Record<string, unknown> }).where(eq(trip.id, id));
}

// ── Constraints ────────────────────────────────────────────────────────────

export interface TripState {
  stays: Stay[];
  wishes: Wish[];
  bookings: Booking[];
}

export async function loadState(tripId: string): Promise<TripState> {
  const [stays, wishes, bookings] = await Promise.all([
    db.select().from(tripStay).where(eq(tripStay.tripId, tripId)).orderBy(asc(tripStay.fromDate), asc(tripStay.id)),
    db.select().from(tripWish).where(eq(tripWish.tripId, tripId)).orderBy(asc(tripWish.sortHint), asc(tripWish.createdAt), asc(tripWish.id)),
    db.select().from(tripBooking).where(eq(tripBooking.tripId, tripId)).orderBy(asc(tripBooking.createdAt), asc(tripBooking.id)),
  ]);
  return { stays: stays.map(toStay), wishes: wishes.map(toWish), bookings: bookings.map(toBooking) };
}

export async function addStay(tripId: string, s: StayInput): Promise<Stay> {
  const [row] = await db
    .insert(tripStay)
    .values({
      tripId,
      name: s.name,
      address: s.address,
      lat: s.location.lat,
      lng: s.location.lng,
      fromDate: s.fromDate,
      toDate: s.toDate,
      checkInMin: s.checkInMin,
      checkOutMin: s.checkOutMin,
    })
    .returning();
  return toStay(row);
}

export async function updateStay(
  tripId: string,
  id: string,
  fields: Partial<Pick<StayInput, 'name' | 'address' | 'location' | 'fromDate' | 'toDate' | 'checkInMin' | 'checkOutMin'>>,
): Promise<void> {
  if (!isUuid(id)) return;
  const { location, ...rest } = fields;
  await db
    .update(tripStay)
    .set({ ...rest, ...(location ? { lat: location.lat, lng: location.lng } : {}) })
    .where(and(eq(tripStay.tripId, tripId), eq(tripStay.id, id)));
}

export async function deleteStay(tripId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const gone = await db.delete(tripStay).where(and(eq(tripStay.tripId, tripId), eq(tripStay.id, id))).returning({ id: tripStay.id });
  return gone.length > 0;
}

export interface NewWish extends WishInput {
  suggested?: boolean;
  place?: Wish['place'];
  facts?: Facts | null;
}

export async function addWishes(tripId: string, wishes: NewWish[]): Promise<Wish[]> {
  if (!wishes.length) return [];
  const [{ top }] = await db.select({ top: max(tripWish.sortHint) }).from(tripWish).where(eq(tripWish.tripId, tripId));
  const start = (top ?? 0) + 10;
  const rows = await db
    .insert(tripWish)
    .values(
      wishes.map((w, i) => ({
        tripId,
        title: w.title,
        priority: w.priority,
        durationSec: w.durationSec,
        partOfDay: w.partOfDay,
        fixedDate: w.fixedDate,
        fixedStartMin: w.fixedStartMin,
        locked: w.fixedStartMin !== null,
        note: w.note,
        replacesMeal: w.replacesMeal ?? null,
        suggested: w.suggested ?? false,
        place: (w.place ?? null) as Record<string, unknown> | null,
        facts: (w.facts ?? null) as Record<string, unknown> | null,
        sortHint: start + i * 10,
      })),
    )
    .returning();
  return rows.map(toWish);
}

export async function updateWish(tripId: string, id: string, patch: WishPatch & { place?: Wish['place']; facts?: Facts | null }): Promise<Wish | null> {
  if (!isUuid(id)) return null;
  const set: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  const [row] = await db
    .update(tripWish)
    .set(set)
    .where(and(eq(tripWish.tripId, tripId), eq(tripWish.id, id)))
    .returning();
  return row ? toWish(row) : null;
}

/** Rewrite the sort hints of several wishes at once (a drag on the page). */
export async function reorderWishes(tripId: string, ids: string[]): Promise<void> {
  const valid = ids.filter(isUuid);
  if (!valid.length) return;
  await db.transaction(async (tx) => {
    for (const [i, id] of valid.entries()) {
      await tx.update(tripWish).set({ sortHint: (i + 1) * 10, updatedAt: new Date() }).where(and(eq(tripWish.tripId, tripId), eq(tripWish.id, id)));
    }
  });
}

export async function deleteWish(tripId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return db.transaction(async (tx) => {
    await tx.delete(tripBooking).where(and(eq(tripBooking.tripId, tripId), eq(tripBooking.wishId, id), eq(tripBooking.status, 'to-book')));
    const gone = await tx.delete(tripWish).where(and(eq(tripWish.tripId, tripId), eq(tripWish.id, id))).returning({ id: tripWish.id });
    return gone.length > 0;
  });
}

export async function getWishes(tripId: string, ids: string[]): Promise<Wish[]> {
  const valid = ids.filter(isUuid);
  if (!valid.length) return [];
  const rows = await db.select().from(tripWish).where(and(eq(tripWish.tripId, tripId), inArray(tripWish.id, valid)));
  return rows.map(toWish);
}

/** Create or edit the booking for a wish (or a free-standing one when wishId is null). */
export async function saveBooking(
  tripId: string,
  target: { bookingId: string | null; wishId: string | null; title: string },
  patch: BookingPatch,
): Promise<Booking | null> {
  if (target.bookingId) {
    if (!isUuid(target.bookingId)) return null;
    const [row] = await db
      .update(tripBooking)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(tripBooking.tripId, tripId), eq(tripBooking.id, target.bookingId)))
      .returning();
    return row ? toBooking(row) : null;
  }
  if (target.wishId && !isUuid(target.wishId)) return null;
  const [row] = await db
    .insert(tripBooking)
    .values({ tripId, wishId: target.wishId, title: patch.title ?? target.title, ...patch })
    .returning();
  return toBooking(row);
}

// ── Plan versions (append-only) ────────────────────────────────────────────

export async function latestPlan(tripId: string): Promise<StoredPlan | null> {
  const [row] = await db.select().from(tripPlan).where(eq(tripPlan.tripId, tripId)).orderBy(desc(tripPlan.version)).limit(1);
  return row ? toPlan(row) : null;
}

export async function planVersions(tripId: string, limit = 20): Promise<Array<Omit<StoredPlan, 'plan' | 'matrix'>>> {
  const rows = await db
    .select({
      id: tripPlan.id,
      tripId: tripPlan.tripId,
      version: tripPlan.version,
      source: tripPlan.source,
      createdAt: tripPlan.createdAt,
      inputHash: tripPlan.inputHash,
      changes: tripPlan.changes,
    })
    .from(tripPlan)
    .where(eq(tripPlan.tripId, tripId))
    .orderBy(desc(tripPlan.version))
    .limit(limit);
  return rows.map((r) => ({ ...r, source: r.source as PlanSource, createdAt: r.createdAt.toISOString(), changes: r.changes ?? [] }));
}

/** The newest version written by the phone, if any (for the running-day rule). */
export async function latestPhonePlan(tripId: string): Promise<Omit<StoredPlan, 'plan' | 'matrix'> | null> {
  const [row] = await db
    .select({ id: tripPlan.id, version: tripPlan.version, createdAt: tripPlan.createdAt })
    .from(tripPlan)
    .where(and(eq(tripPlan.tripId, tripId), eq(tripPlan.source, 'phone')))
    .orderBy(desc(tripPlan.version))
    .limit(1);
  return row ? { ...row, tripId, source: 'phone', createdAt: row.createdAt.toISOString(), inputHash: '', changes: [] } : null;
}

/**
 * Append a plan version: `version` is one more than the newest. Writers for
 * one trip are serialised by a transaction-scoped advisory lock on the trip,
 * so two concurrent edits get consecutive numbers rather than a clash (the
 * unique key stays as the backstop).
 */
export async function appendPlan(
  tripId: string,
  p: { source: PlanSource; inputHash: string; plan: SolvedPlan; matrix: TravelMatrix | null; changes: string[]; constraints?: Record<string, unknown> | null },
): Promise<StoredPlan> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trip_plan:${tripId}`}))`);
    const [{ top }] = await tx.select({ top: max(tripPlan.version) }).from(tripPlan).where(eq(tripPlan.tripId, tripId));
    const [row] = await tx
      .insert(tripPlan)
      .values({
        tripId,
        version: (top ?? 0) + 1,
        source: p.source,
        inputHash: p.inputHash,
        plan: p.plan as unknown as Record<string, unknown>,
        matrix: p.matrix as unknown as Record<string, unknown> | null,
        changes: p.changes,
        // v8: what this version was solved from, so undo can put it back.
        constraints: p.constraints ?? null,
      })
      .returning();
    await tx
      .update(trip)
      .set({ updatedAt: new Date(), status: sql`case when ${trip.status} = 'draft' then 'planned' else ${trip.status} end` })
      .where(eq(trip.id, tripId));
    return toPlan(row);
  });
}

// ── Events (idempotent on clientId) ────────────────────────────────────────

/** Insert the events not seen before; returns the clientIds that are NEW. */
export async function recordEvents(tripId: string, events: TripEvent[]): Promise<Set<string>> {
  if (!events.length) return new Set();
  const rows = await db
    .insert(tripEvent)
    .values(
      events.map((e) => ({
        tripId,
        clientId: e.clientId,
        kind: e.kind,
        stopId: e.stopId,
        wishId: e.wishId,
        at: new Date(e.at),
        detail: e.detail,
      })),
    )
    .onConflictDoNothing({ target: [tripEvent.tripId, tripEvent.clientId] })
    .returning({ clientId: tripEvent.clientId });
  return new Set(rows.map((r) => r.clientId));
}

export async function setEventPlanVersion(tripId: string, clientId: string, version: number): Promise<void> {
  await db.update(tripEvent).set({ planVersion: version }).where(and(eq(tripEvent.tripId, tripId), eq(tripEvent.clientId, clientId)));
}

export async function recentEvents(tripId: string, limit = 50): Promise<Array<TripEvent & { receivedAt: string }>> {
  const rows = await db.select().from(tripEvent).where(eq(tripEvent.tripId, tripId)).orderBy(desc(tripEvent.at)).limit(limit);
  return rows.map((r) => ({
    clientId: r.clientId,
    kind: r.kind as TripEvent['kind'],
    stopId: r.stopId,
    wishId: r.wishId,
    at: r.at.toISOString(),
    detail: r.detail ?? null,
    receivedAt: r.receivedAt.toISOString(),
  }));
}


// ── v2: guides and the planning conversation ───────────────────────────────

export async function setTripGuide(id: string, guide: TripGuide | null): Promise<void> {
  await db.update(trip).set({ guide: guide as unknown as Record<string, unknown> | null }).where(eq(trip.id, id));
}

export async function setStopGuide(tripId: string, wishId: string, guide: StopGuide | null): Promise<void> {
  if (!isUuid(wishId)) return;
  await db
    .update(tripWish)
    .set({ guide: guide as unknown as Record<string, unknown> | null })
    .where(and(eq(tripWish.tripId, tripId), eq(tripWish.id, wishId)));
}

/** Ops that carry what someone said about themselves: never shown beside a shared event. */
const PRIVATE_OPS = new Set(['remember', 'updateProfile']);

function toMessage(r: typeof tripMessage.$inferSelect): TripMessage {
  const ops = (r.ops ?? []) as TripOp[];
  return {
    id: r.id,
    role: r.role as TripMessage['role'],
    text: r.text,
    ops: r.role === 'event' ? ops.filter((o) => !PRIVATE_OPS.has(o.op)) : ops,
    planVersion: r.planVersion,
    surface: r.surface as TripMessage['surface'],
    createdAt: r.createdAt.toISOString(),
    ...(r.research && (r.research as unknown[]).length ? { research: r.research as ResearchStep[] } : {}),
  };
}

/**
 * Whose conversation to read (v5): each caller sees only their own thread —
 * their messages and the replies to them — plus the plan-change events
 * everyone sees. The creator also gets the rows from before authors were
 * stored (author null).
 */
export interface MessageViewer {
  email: string;
  isCreator: boolean;
}

export const viewerOf = (trip: Pick<TripRecord, 'ownerEmail'>, email: string): MessageViewer => ({
  email: email.trim().toLowerCase(),
  isCreator: email.trim().toLowerCase() === trip.ownerEmail.trim().toLowerCase(),
});

/** The last `limit` messages this viewer may see, oldest first. */
export async function recentMessages(tripId: string, viewer: MessageViewer, limit = 50): Promise<TripMessage[]> {
  const mine = eq(tripMessage.authorEmail, viewer.email);
  const shared = and(isNull(tripMessage.authorEmail), viewer.isCreator ? sql`true` : eq(tripMessage.role, 'event'));
  const rows = await db
    .select()
    .from(tripMessage)
    .where(and(eq(tripMessage.tripId, tripId), or(mine, shared)))
    .orderBy(desc(tripMessage.createdAt), desc(tripMessage.id))
    .limit(limit);
  return rows.reverse().map(toMessage);
}

export async function addMessage(
  tripId: string,
  m: Pick<TripMessage, 'role' | 'text' | 'ops' | 'planVersion' | 'surface'> & {
    at?: Date;
    research?: ResearchStep[];
    /** v5: the speaker, whose thread this is; null for a plan change everyone sees. */
    author?: { email: string; id: string | null } | null;
  },
): Promise<TripMessage> {
  const [row] = await db
    .insert(tripMessage)
    .values({
      tripId,
      role: m.role,
      text: m.text.slice(0, 8000),
      ops: m.ops as unknown[],
      planVersion: m.planVersion,
      surface: m.surface,
      research: m.research?.length ? (m.research as unknown[]) : null,
      authorEmail: m.author ? m.author.email.trim().toLowerCase() : null,
      authorId: m.author?.id ?? null,
      ...(m.at ? { createdAt: m.at } : {}),
    })
    .returning();
  return toMessage(row);
}

// ── v3: getting there and back ─────────────────────────────────────────────

type TransportRow = typeof tripTransport.$inferSelect;

function toTransport(r: TransportRow): TransportSegment {
  return {
    id: r.id,
    kind: r.kind as TransportSegment['kind'],
    direction: r.direction as TransportSegment['direction'],
    carrier: r.carrier,
    number: r.number,
    from: r.fromPlace as unknown as TransportSegment['from'],
    to: r.toPlace as unknown as TransportSegment['to'],
    departDate: r.departDate,
    departMin: r.departMin,
    arriveDate: r.arriveDate,
    arriveMin: r.arriveMin,
    confidence: r.confidence as TransportSegment['confidence'],
    status: (r.status as TransportSegment['status']) ?? null,
    delayMin: r.delayMin,
    bookingRef: r.bookingRef,
    sources: r.sources ?? [],
    checkedAt: r.checkedAt ? r.checkedAt.toISOString() : null,
  };
}

function transportValues(s: Partial<Omit<TransportSegment, 'id'>>) {
  return {
    ...(s.kind !== undefined ? { kind: s.kind } : {}),
    ...(s.direction !== undefined ? { direction: s.direction } : {}),
    ...(s.carrier !== undefined ? { carrier: s.carrier } : {}),
    ...(s.number !== undefined ? { number: s.number } : {}),
    ...(s.from !== undefined ? { fromPlace: s.from as unknown as Record<string, unknown> } : {}),
    ...(s.to !== undefined ? { toPlace: s.to as unknown as Record<string, unknown> } : {}),
    ...(s.departDate !== undefined ? { departDate: s.departDate } : {}),
    ...(s.departMin !== undefined ? { departMin: s.departMin } : {}),
    ...(s.arriveDate !== undefined ? { arriveDate: s.arriveDate } : {}),
    ...(s.arriveMin !== undefined ? { arriveMin: s.arriveMin } : {}),
    ...(s.confidence !== undefined ? { confidence: s.confidence } : {}),
    ...(s.status !== undefined ? { status: s.status } : {}),
    ...(s.delayMin !== undefined ? { delayMin: s.delayMin } : {}),
    ...(s.bookingRef !== undefined ? { bookingRef: s.bookingRef } : {}),
    ...(s.sources !== undefined ? { sources: s.sources } : {}),
    ...(s.checkedAt !== undefined ? { checkedAt: s.checkedAt ? new Date(s.checkedAt) : null } : {}),
  };
}

export async function listTransport(tripId: string): Promise<TransportSegment[]> {
  const rows = await db.select().from(tripTransport).where(eq(tripTransport.tripId, tripId)).orderBy(asc(tripTransport.departDate), asc(tripTransport.departMin), asc(tripTransport.id));
  return rows.map(toTransport);
}

export async function addTransport(tripId: string, s: Omit<TransportSegment, 'id'>): Promise<TransportSegment> {
  const [row] = await db
    .insert(tripTransport)
    .values({ tripId, ...(transportValues(s) as Required<ReturnType<typeof transportValues>>) } as typeof tripTransport.$inferInsert)
    .returning();
  return toTransport(row);
}

export async function updateTransport(tripId: string, id: string, fields: Partial<Omit<TransportSegment, 'id'>>): Promise<void> {
  if (!isUuid(id)) return;
  await db.update(tripTransport).set({ ...transportValues(fields), updatedAt: new Date() }).where(and(eq(tripTransport.tripId, tripId), eq(tripTransport.id, id)));
}

export async function deleteTransport(tripId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const gone = await db.delete(tripTransport).where(and(eq(tripTransport.tripId, tripId), eq(tripTransport.id, id))).returning({ id: tripTransport.id });
  return gone.length > 0;
}

// ── v5: suggestions ────────────────────────────────────────────────────────

type SuggestionRow = typeof tripSuggestion.$inferSelect;

export interface SuggestionRecord extends TripSuggestion {
  byEmail: string;
}

function toSuggestion(r: SuggestionRow): SuggestionRecord {
  return {
    id: r.id,
    tripId: r.tripId,
    byId: r.byId,
    byName: r.byName,
    byEmail: r.byEmail,
    date: r.date,
    stage: r.stage as DayStage,
    wish: r.wish as unknown as WishDraft,
    note: r.note,
    fitText: r.fitText,
    status: r.status as SuggestionStatus,
    decidedById: r.decidedById,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** The wire shape: never an email. */
export function suggestionWire(s: SuggestionRecord): TripSuggestion {
  const { byEmail: _e, ...rest } = s;
  return rest;
}

/** Pending suggestions and the last `decided` decided ones, newest first. */
export async function listSuggestions(tripId: string, decided = 20): Promise<SuggestionRecord[]> {
  const rows = await db.select().from(tripSuggestion).where(eq(tripSuggestion.tripId, tripId)).orderBy(desc(tripSuggestion.createdAt), desc(tripSuggestion.id));
  const pending = rows.filter((r) => r.status === 'pending');
  const done = rows.filter((r) => r.status !== 'pending').slice(0, decided);
  return [...pending, ...done].map(toSuggestion);
}

export async function getSuggestion(tripId: string, id: string): Promise<SuggestionRecord | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(tripSuggestion).where(and(eq(tripSuggestion.tripId, tripId), eq(tripSuggestion.id, id))).limit(1);
  return row ? toSuggestion(row) : null;
}

export async function addSuggestion(
  tripId: string,
  s: { byEmail: string; byId: string; byName: string; date: string; stage: DayStage; wish: WishDraft; note: string | null; fitText: string | null },
): Promise<SuggestionRecord> {
  const [row] = await db
    .insert(tripSuggestion)
    .values({ tripId, ...s, wish: s.wish as unknown as Record<string, unknown> })
    .returning();
  return toSuggestion(row);
}

/** Move a PENDING suggestion to a decision; null when it was no longer pending (someone got there first). */
export async function decideSuggestion(
  tripId: string,
  id: string,
  status: Exclude<SuggestionStatus, 'pending'>,
  by: { email: string; id: string } | null,
): Promise<SuggestionRecord | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .update(tripSuggestion)
    .set({ status, decidedByEmail: by?.email ?? null, decidedById: by?.id ?? null, decidedAt: new Date() })
    .where(and(eq(tripSuggestion.tripId, tripId), eq(tripSuggestion.id, id), eq(tripSuggestion.status, 'pending')))
    .returning();
  return row ? toSuggestion(row) : null;
}
