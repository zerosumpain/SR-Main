// src/lib/trips/decisions.store.server.ts
//
// v8: Drizzle access for the planner's decisions — proposals, questions, the
// research pack's places, durable jobs, provenance, the pack summary and the
// constraint snapshots that make undo possible. Rows are mapped to the shapes
// in ./decisions at this boundary; emails never leave it (the wire gets names).

import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { trip, tripJob, tripPlace, tripPlan, tripProposal, tripQuestion } from '$lib/db/schema';
import type { Booking, PlaceImage, Stay, TransportSegment, Trip, TripOp, Wish, Facts } from './model';
import type {
  JobStage,
  PackPlace,
  PackSummary,
  PlanDiff,
  Proposal,
  ProposalKind,
  ProposalScope,
  ProposalStatus,
  ProposalTradeoffs,
  Provenance,
  ProvenanceEntry,
  Question,
  QuestionAnswer,
  QuestionAudience,
  QuestionSource,
  QuestionStatus,
  RejectReason,
  ShapeSummary,
  Source,
} from './decisions';
import { EMPTY_PACK } from './decisions';

// ── Constraint snapshots (undo / restore) ──────────────────────────────────

/** Everything a plan version was solved from: what undo puts back. */
export interface TripConstraints {
  trip: Pick<Trip, 'title' | 'destination' | 'timeZone' | 'startDate' | 'endDate' | 'pace' | 'modes' | 'notes' | 'dayLoads'>;
  stays: Stay[];
  wishes: Wish[];
  bookings: Booking[];
  transport: TransportSegment[];
}

export function constraintsOf(t: Trip, state: { stays: Stay[]; wishes: Wish[]; bookings: Booking[] }, transport: TransportSegment[]): TripConstraints {
  return {
    trip: { title: t.title, destination: t.destination, timeZone: t.timeZone, startDate: t.startDate, endDate: t.endDate, pace: t.pace, modes: t.modes, notes: t.notes, dayLoads: t.dayLoads ?? {} },
    stays: state.stays,
    // Guides are big and regenerated: the snapshot keeps what the solver reads.
    wishes: state.wishes.map(({ guide: _g, ...w }) => w as Wish),
    bookings: state.bookings,
    transport,
  };
}

/** A version's snapshot, or null for versions from before v8 (no undo past them). */
export async function planConstraints(tripId: string, version: number): Promise<TripConstraints | null> {
  const [row] = await db.select({ c: tripPlan.constraints }).from(tripPlan).where(and(eq(tripPlan.tripId, tripId), eq(tripPlan.version, version))).limit(1);
  return (row?.c as unknown as TripConstraints | null) ?? null;
}

// ── Provenance and the pack summary (columns on trip) ──────────────────────

export async function readProvenance(tripId: string): Promise<Provenance> {
  const [row] = await db.select({ p: trip.provenance }).from(trip).where(eq(trip.id, tripId)).limit(1);
  return (row?.p as unknown as Provenance | null) ?? {};
}

/** Merge entries into the trip's provenance (a null entry removes a key). */
export async function noteProvenance(tripId: string, entries: Record<string, Omit<ProvenanceEntry, 'at'> | null>): Promise<void> {
  if (!Object.keys(entries).length) return;
  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ p: trip.provenance }).from(trip).where(eq(trip.id, tripId)).for('update').limit(1);
    const next: Provenance = { ...((row?.p as unknown as Provenance | null) ?? {}) };
    for (const [k, v] of Object.entries(entries)) {
      if (v === null) delete next[k];
      else next[k] = { ...v, at };
    }
    await tx.update(trip).set({ provenance: next as unknown as Record<string, unknown> }).where(eq(trip.id, tripId));
  });
}

export async function readPack(tripId: string): Promise<PackSummary> {
  const [row] = await db.select({ p: trip.pack }).from(trip).where(eq(trip.id, tripId)).limit(1);
  return { ...EMPTY_PACK, ...((row?.p as unknown as PackSummary | null) ?? {}) };
}

export async function writePack(tripId: string, patch: Partial<PackSummary>): Promise<PackSummary> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ p: trip.pack }).from(trip).where(eq(trip.id, tripId)).for('update').limit(1);
    const next: PackSummary = { ...EMPTY_PACK, ...((row?.p as unknown as PackSummary | null) ?? {}), ...patch };
    await tx.update(trip).set({ pack: next as unknown as Record<string, unknown> }).where(eq(trip.id, tripId));
    return next;
  });
}

// ── The research pack's places ─────────────────────────────────────────────

type PlaceRow = typeof tripPlace.$inferSelect;

function toPackPlace(r: PlaceRow): PackPlace {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as PackPlace['kind'],
    tags: r.tags ?? [],
    place: r.place as unknown as PackPlace['place'],
    why: r.why,
    neighbourhood: r.neighbourhood,
    durationMin: r.durationMin,
    indoor: r.indoor,
    kidFriendly: r.kidFriendly,
    costText: r.costText,
    lessVisited: r.lessVisited,
    bookingRequired: r.bookingRequired,
    bookAheadDays: r.bookAheadDays,
    facts: (r.facts as unknown as Facts | null) ?? null,
    image: (r.image as unknown as PlaceImage | null) ?? null,
    wikidata: r.wikidata,
    sources: r.sources ?? [],
    status: r.status as PackPlace['status'],
    rejectReason: (r.rejectReason as RejectReason | null) ?? null,
    wishId: r.wishId,
    checkedAt: r.checkedAt ? r.checkedAt.toISOString() : null,
  };
}

function placeValues(p: Partial<Omit<PackPlace, 'id'>>) {
  return {
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.kind !== undefined ? { kind: p.kind } : {}),
    ...(p.tags !== undefined ? { tags: p.tags } : {}),
    ...(p.place !== undefined ? { place: p.place as unknown as Record<string, unknown> } : {}),
    ...(p.why !== undefined ? { why: p.why } : {}),
    ...(p.neighbourhood !== undefined ? { neighbourhood: p.neighbourhood } : {}),
    ...(p.durationMin !== undefined ? { durationMin: p.durationMin } : {}),
    ...(p.indoor !== undefined ? { indoor: p.indoor } : {}),
    ...(p.kidFriendly !== undefined ? { kidFriendly: p.kidFriendly } : {}),
    ...(p.costText !== undefined ? { costText: p.costText } : {}),
    ...(p.lessVisited !== undefined ? { lessVisited: p.lessVisited } : {}),
    ...(p.bookingRequired !== undefined ? { bookingRequired: p.bookingRequired } : {}),
    ...(p.bookAheadDays !== undefined ? { bookAheadDays: p.bookAheadDays } : {}),
    ...(p.facts !== undefined ? { facts: p.facts as unknown as Record<string, unknown> | null } : {}),
    ...(p.image !== undefined ? { image: p.image as unknown as Record<string, unknown> | null } : {}),
    ...(p.wikidata !== undefined ? { wikidata: p.wikidata } : {}),
    ...(p.sources !== undefined ? { sources: p.sources } : {}),
    ...(p.status !== undefined ? { status: p.status } : {}),
    ...(p.rejectReason !== undefined ? { rejectReason: p.rejectReason } : {}),
    ...(p.wishId !== undefined ? { wishId: p.wishId } : {}),
    ...(p.checkedAt !== undefined ? { checkedAt: p.checkedAt ? new Date(p.checkedAt) : null } : {}),
  };
}

export async function listPackPlaces(tripId: string, opts: { status?: PackPlace['status'][] } = {}): Promise<PackPlace[]> {
  const where = opts.status?.length ? and(eq(tripPlace.tripId, tripId), inArray(tripPlace.status, opts.status)) : eq(tripPlace.tripId, tripId);
  const rows = await db.select().from(tripPlace).where(where).orderBy(tripPlace.createdAt, tripPlace.id);
  return rows.map(toPackPlace);
}

export async function getPackPlace(tripId: string, id: string): Promise<PackPlace | null> {
  const [row] = await db.select().from(tripPlace).where(and(eq(tripPlace.tripId, tripId), eq(tripPlace.id, id))).limit(1);
  return row ? toPackPlace(row) : null;
}

export async function addPackPlaces(tripId: string, places: Array<Omit<PackPlace, 'id'>>): Promise<PackPlace[]> {
  if (!places.length) return [];
  const rows = await db
    .insert(tripPlace)
    .values(places.map((p) => ({ tripId, ...placeValues(p), name: p.name, kind: p.kind, place: p.place as unknown as Record<string, unknown> })))
    .returning();
  return rows.map(toPackPlace);
}

export async function updatePackPlace(tripId: string, id: string, patch: Partial<Omit<PackPlace, 'id'>>): Promise<void> {
  const values = placeValues(patch);
  if (!Object.keys(values).length) return;
  await db.update(tripPlace).set(values).where(and(eq(tripPlace.tripId, tripId), eq(tripPlace.id, id)));
}

// ── Proposals ──────────────────────────────────────────────────────────────

type ProposalRow = typeof tripProposal.$inferSelect;

function toProposal(r: ProposalRow): Proposal {
  return {
    id: r.id,
    groupId: r.groupId,
    kind: r.kind as ProposalKind,
    title: r.title,
    why: r.why,
    scope: r.scope as unknown as ProposalScope,
    ops: (r.ops ?? []) as TripOp[],
    diff: r.diff as unknown as PlanDiff,
    tradeoffs: r.tradeoffs as unknown as ProposalTradeoffs,
    evidence: (r.evidence ?? []) as Source[],
    place: (r.place as unknown as Proposal['place']) ?? null,
    image: (r.image as unknown as PlaceImage | null) ?? null,
    packPlaceId: r.packPlaceId,
    shape: (r.shape as unknown as ShapeSummary | null) ?? null,
    preview: (r.preview ?? []) as Proposal['preview'],
    basedOnVersion: r.basedOnVersion,
    status: r.status as ProposalStatus,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  };
}

export type NewProposal = Omit<Proposal, 'id' | 'status' | 'reason' | 'createdAt' | 'decidedAt'>;

export async function addProposals(tripId: string, proposals: NewProposal[], authorEmail: string | null = null): Promise<Proposal[]> {
  if (!proposals.length) return [];
  const rows = await db
    .insert(tripProposal)
    .values(
      proposals.map((p) => ({
        tripId,
        groupId: p.groupId,
        kind: p.kind,
        title: p.title,
        why: p.why,
        scope: p.scope as unknown as Record<string, unknown>,
        ops: p.ops as unknown[],
        diff: p.diff as unknown as Record<string, unknown>,
        tradeoffs: p.tradeoffs as unknown as Record<string, unknown>,
        evidence: p.evidence,
        place: p.place as unknown as Record<string, unknown> | null,
        image: p.image as unknown as Record<string, unknown> | null,
        packPlaceId: p.packPlaceId,
        shape: p.shape as unknown as Record<string, unknown> | null,
        preview: p.preview as unknown[],
        basedOnVersion: p.basedOnVersion,
        authorEmail: authorEmail ? authorEmail.trim().toLowerCase() : null,
      })),
    )
    .returning();
  return rows.map(toProposal);
}

export async function getProposal(tripId: string, id: string): Promise<Proposal | null> {
  const [row] = await db.select().from(tripProposal).where(and(eq(tripProposal.tripId, tripId), eq(tripProposal.id, id))).limit(1);
  return row ? toProposal(row) : null;
}

/** Open proposals, newest group first; plus the last `decided` decided ones when asked. */
export async function listProposals(tripId: string, opts: { status?: ProposalStatus[]; limit?: number } = {}): Promise<Proposal[]> {
  const status = opts.status ?? ['open'];
  const rows = await db
    .select()
    .from(tripProposal)
    .where(and(eq(tripProposal.tripId, tripId), inArray(tripProposal.status, status)))
    .orderBy(desc(tripProposal.createdAt), tripProposal.id)
    .limit(opts.limit ?? 30);
  return rows.map(toProposal);
}

/** Decide one; returns false when it was no longer open (someone else decided). */
export async function decideProposal(tripId: string, id: string, status: Exclude<ProposalStatus, 'open'>, reason: string | null, byEmail: string | null): Promise<boolean> {
  const rows = await db
    .update(tripProposal)
    .set({ status, reason, decidedByEmail: byEmail ? byEmail.trim().toLowerCase() : null, decidedAt: new Date() })
    .where(and(eq(tripProposal.tripId, tripId), eq(tripProposal.id, id), eq(tripProposal.status, 'open')))
    .returning({ id: tripProposal.id });
  return rows.length > 0;
}

/** Close the rest of a group once one is taken. */
export async function supersedeGroup(tripId: string, groupId: string, exceptId: string, reason: string): Promise<void> {
  await db
    .update(tripProposal)
    .set({ status: 'superseded', reason, decidedAt: new Date() })
    .where(and(eq(tripProposal.tripId, tripId), eq(tripProposal.groupId, groupId), ne(tripProposal.id, exceptId), eq(tripProposal.status, 'open')));
}

/** Expire open proposals of some kinds (e.g. every open 'shape' once one is chosen). */
export async function expireProposals(tripId: string, kinds: ProposalKind[], reason: string): Promise<void> {
  if (!kinds.length) return;
  await db
    .update(tripProposal)
    .set({ status: 'expired', reason, decidedAt: new Date() })
    .where(and(eq(tripProposal.tripId, tripId), inArray(tripProposal.kind, kinds), eq(tripProposal.status, 'open')));
}

// ── Questions ──────────────────────────────────────────────────────────────

type QuestionRow = typeof tripQuestion.$inferSelect;
type Vote = { email: string; name: string };

function toQuestion(r: QuestionRow): Question {
  const votes = (r.votes ?? {}) as Record<string, Vote[]>;
  return {
    id: r.id,
    key: r.key,
    origin: r.source as QuestionSource,
    prompt: r.prompt,
    why: r.why,
    answers: (r.answers ?? []) as QuestionAnswer[],
    defaultAnswerId: r.defaultAnswerId,
    appliedDefault: r.appliedDefault,
    ifSkipped: r.ifSkipped,
    affects: r.affects as unknown as Question['affects'],
    impact: r.impact,
    audience: r.audience as QuestionAudience,
    deadline: r.deadline,
    status: r.status as QuestionStatus,
    answerId: r.answerId,
    answeredByName: r.answeredByName,
    // Names only on the wire.
    votes: Object.fromEntries(Object.entries(votes).map(([a, vs]) => [a, (vs ?? []).map((v) => v.name)])),
    basedOnVersion: r.basedOnVersion,
    createdAt: r.createdAt.toISOString(),
    answeredAt: r.answeredAt ? r.answeredAt.toISOString() : null,
  };
}

export type NewQuestion = Omit<Question, 'id' | 'status' | 'answerId' | 'answeredByName' | 'votes' | 'createdAt' | 'answeredAt'>;

export async function addQuestion(tripId: string, q: NewQuestion): Promise<Question> {
  const [row] = await db
    .insert(tripQuestion)
    .values({
      tripId,
      key: q.key,
      source: q.origin,
      prompt: q.prompt,
      why: q.why,
      answers: q.answers as unknown[],
      defaultAnswerId: q.defaultAnswerId,
      appliedDefault: q.appliedDefault,
      ifSkipped: q.ifSkipped,
      affects: q.affects as unknown as Record<string, unknown>,
      impact: q.impact,
      audience: q.audience,
      deadline: q.deadline,
      basedOnVersion: q.basedOnVersion,
    })
    .returning();
  return toQuestion(row);
}

export async function getQuestion(tripId: string, id: string): Promise<Question | null> {
  const [row] = await db.select().from(tripQuestion).where(and(eq(tripQuestion.tripId, tripId), eq(tripQuestion.id, id))).limit(1);
  return row ? toQuestion(row) : null;
}

export async function listQuestions(tripId: string, opts: { status?: QuestionStatus[]; limit?: number } = {}): Promise<Question[]> {
  const status = opts.status ?? ['open'];
  const rows = await db
    .select()
    .from(tripQuestion)
    .where(and(eq(tripQuestion.tripId, tripId), inArray(tripQuestion.status, status)))
    .orderBy(desc(tripQuestion.impact), desc(tripQuestion.createdAt))
    .limit(opts.limit ?? 30);
  return rows.map(toQuestion);
}

/** Every key ever asked on the trip, with its latest status — for "never ask twice". */
export async function questionKeys(tripId: string): Promise<Map<string, QuestionStatus>> {
  const rows = await db
    .select({ key: tripQuestion.key, status: tripQuestion.status, createdAt: tripQuestion.createdAt })
    .from(tripQuestion)
    .where(eq(tripQuestion.tripId, tripId))
    .orderBy(tripQuestion.createdAt);
  return new Map(rows.map((r) => [r.key, r.status as QuestionStatus]));
}

/** Close an open question; false when it was no longer open. */
export async function closeQuestion(
  tripId: string,
  id: string,
  status: Exclude<QuestionStatus, 'open'>,
  answer: { answerId: string | null; byEmail: string | null; byName: string | null },
): Promise<boolean> {
  const rows = await db
    .update(tripQuestion)
    .set({ status, answerId: answer.answerId, answeredByEmail: answer.byEmail ? answer.byEmail.trim().toLowerCase() : null, answeredByName: answer.byName, answeredAt: new Date() })
    .where(and(eq(tripQuestion.tripId, tripId), eq(tripQuestion.id, id), eq(tripQuestion.status, 'open')))
    .returning({ id: tripQuestion.id });
  return rows.length > 0;
}

/** Record one family member's vote (replacing their earlier one). */
export async function voteQuestion(tripId: string, id: string, answerId: string, voter: Vote): Promise<Question | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(tripQuestion).where(and(eq(tripQuestion.tripId, tripId), eq(tripQuestion.id, id))).for('update').limit(1);
    if (!row || row.status !== 'open') return null;
    const email = voter.email.trim().toLowerCase();
    const votes = Object.fromEntries(Object.entries((row.votes ?? {}) as Record<string, Vote[]>).map(([a, vs]) => [a, (vs ?? []).filter((v) => v.email !== email)]));
    votes[answerId] = [...(votes[answerId] ?? []), { email, name: voter.name }];
    const [saved] = await tx.update(tripQuestion).set({ votes: votes as unknown as Record<string, unknown> }).where(eq(tripQuestion.id, id)).returning();
    return toQuestion(saved);
  });
}

export async function markQuestionPushed(tripId: string, id: string): Promise<void> {
  await db.update(tripQuestion).set({ pushedAt: new Date() }).where(and(eq(tripQuestion.tripId, tripId), eq(tripQuestion.id, id)));
}

/** When a question on this trip was last pushed (the one-a-day rule). */
export async function lastQuestionPush(tripId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`max(${tripQuestion.pushedAt})` })
    .from(tripQuestion)
    .where(eq(tripQuestion.tripId, tripId));
  return row?.at ? new Date(row.at) : null;
}

// ── Durable jobs ───────────────────────────────────────────────────────────

export interface JobRow {
  id: string;
  tripId: string | null;
  ownerEmail: string;
  kind: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  stages: JobStage[];
  result: unknown;
  error: string | null;
  cancelRequested: boolean;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

type JobDbRow = typeof tripJob.$inferSelect;

function toJob(r: JobDbRow): JobRow {
  return {
    id: r.id,
    tripId: r.tripId,
    ownerEmail: r.ownerEmail,
    kind: r.kind,
    status: r.status as JobRow['status'],
    stages: (r.stages ?? []) as JobStage[],
    result: r.result ?? null,
    error: r.error,
    cancelRequested: r.cancelRequested,
    startedAt: r.startedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  };
}

export async function insertJob(j: { id: string; tripId: string | null; ownerEmail: string; kind: string; stages: JobStage[] }): Promise<void> {
  await db.insert(tripJob).values({ id: j.id, tripId: j.tripId, ownerEmail: j.ownerEmail.trim().toLowerCase(), kind: j.kind, stages: j.stages as unknown[] });
}

export async function updateJob(id: string, patch: Partial<Pick<JobRow, 'tripId' | 'status' | 'stages' | 'result' | 'error' | 'finishedAt'>>): Promise<void> {
  await db
    .update(tripJob)
    .set({
      ...(patch.tripId !== undefined ? { tripId: patch.tripId } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.stages !== undefined ? { stages: patch.stages as unknown[] } : {}),
      ...(patch.result !== undefined ? { result: patch.result as never } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt ? new Date(patch.finishedAt) : null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tripJob.id, id));
}

export async function getJob(id: string): Promise<JobRow | null> {
  const [row] = await db.select().from(tripJob).where(eq(tripJob.id, id)).limit(1);
  return row ? toJob(row) : null;
}

/** Ask a running job to stop; true when it was running. */
export async function requestCancel(id: string, ownerEmail: string): Promise<boolean> {
  const rows = await db
    .update(tripJob)
    .set({ cancelRequested: true, updatedAt: new Date() })
    .where(and(eq(tripJob.id, id), eq(tripJob.ownerEmail, ownerEmail.trim().toLowerCase()), eq(tripJob.status, 'running')))
    .returning({ id: tripJob.id });
  return rows.length > 0;
}

export async function cancelRequested(id: string): Promise<boolean> {
  const [row] = await db.select({ c: tripJob.cancelRequested }).from(tripJob).where(eq(tripJob.id, id)).limit(1);
  return row?.c === true;
}

/** At start-up: jobs left running by a previous process cannot finish — say so. */
export async function failOrphanJobs(before: Date, message: string): Promise<number> {
  const rows = await db
    .update(tripJob)
    .set({ status: 'failed', error: message, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tripJob.status, 'running'), sql`${tripJob.startedAt} < ${before}`))
    .returning({ id: tripJob.id });
  return rows.length;
}

/** The latest running job of a kind for a trip (the pack build), so a second start joins it. */
export async function runningJob(tripId: string, kind: string): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(tripJob)
    .where(and(eq(tripJob.tripId, tripId), eq(tripJob.kind, kind), eq(tripJob.status, 'running')))
    .orderBy(desc(tripJob.startedAt))
    .limit(1);
  return row ? toJob(row) : null;
}
