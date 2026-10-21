// src/lib/trips/questions.server.ts
//
// v8: quick questions — generated from the brief's gaps, near-ties, clashes,
// research and reactions (./questions), and drafted by the planner; each
// answer dry-run (./dryrun) so a question exists only when its answers solve
// to different plans; ranked by how much changes × how soon it must be
// decided; stored, at most MAX_OPEN_QUESTIONS open per audience; answered
// with a tap.
//
// Assume-and-ask: when the answer we would assume changes the plan, it is
// applied straight away (the plan never waits on a question) and the other
// answers carry the ops that put it back first — so answering either way is
// one checked change, with its own version and undo.
//
// Answers go through the same validated path as every edit (./converse.server
// `applyAndReplan`, places trusted because they were checked here), append a
// version and return its difference. A family question collects votes; a
// parent's or the creator's answer decides it. At most one question is
// pushed per trip per day before the trip.

import { getOwnerEmails } from '$lib/server/access';
import { pushToEmails } from '$lib/server/push-devices';
import type { PushMessage } from '$lib/server/apns';
import { solveTrip } from '$lib/trips/solver';
import { dayLabel } from './changes';
import { applyAndReplan } from './converse.server';
import { EMPTY_DIFF, MAX_OPEN_QUESTIONS, REJECT_REASON_LABEL, REJECT_REASONS, type PlanDiff, type Question, type QuestionAnswer, type QuestionAudience, type QuestionDraft, type RejectReason } from './decisions';
import { audiencesFor } from './decisions.bundle.server';
import {
  addQuestion,
  closeQuestion,
  decideProposal,
  expireProposals,
  getQuestion,
  lastQuestionPush,
  listPackPlaces,
  listProposals,
  listQuestions,
  markQuestionPushed,
  noteProvenance,
  questionKeys,
  readPack,
  supersedeGroup,
  voteQuestion,
} from './decisions.store.server';
import { dryRun, planDiff, type DryRunResult } from './dryrun';
import type { LatLng, LocalDate, SolvedPlan, TripAccess, TripOp, Wish } from './model';
import { emptyFacts } from './research';
import { findPlaceLoosely } from './research.server';
import { solverInput } from './plan.server';
import { provenanceKeys } from './provenance-ops';
import {
  answerSummary,
  briefPatchOps,
  canInvert,
  generateQuestions,
  inverseOps,
  planSignature,
  urgency,
  whyLine,
  type Alternatives,
  type Draft,
  type Snapshot,
} from './questions';
import { localDateIn } from './routing';
import { getTripById, latestPlan, listTransport, loadState, tripOnly, type StoredPlan, type TripRecord } from './store.server';

// ── The base every answer is checked against ───────────────────────────────

interface Base {
  latest: StoredPlan;
  run: Parameters<typeof dryRun>[0];
  baseline: SolvedPlan;
  signature: string;
  titles: Record<string, string>;
  snapshot: Snapshot;
  factsFor: (place: { osmId: string | null; name: string }) => Wish['facts'];
}

async function loadBase(trip: TripRecord): Promise<Base | null> {
  const latest = await latestPlan(trip.id);
  if (!latest) return null;
  const [{ input, state }, transport, places] = await Promise.all([solverInput(trip, latest, { reuseMatrix: true }), listTransport(trip.id), listPackPlaces(trip.id).catch(() => [])]);
  const baseline = solveTrip(input);
  const t = tripOnly(trip);
  const byOsm = new Map(places.filter((p) => p.place.osmId).map((p) => [p.place.osmId, p]));
  return {
    latest,
    run: { input, ctx: { trip: t, stays: state.stays, wishes: state.wishes, bookings: state.bookings, transport, profile: trip.profile } },
    baseline,
    signature: planSignature(baseline, input.trip),
    titles: Object.fromEntries(state.wishes.map((w) => [w.id, w.title])),
    snapshot: { trip: t, stays: state.stays, wishes: state.wishes, bookings: state.bookings, profile: trip.profile },
    // A pack place's hours count in the check, as they will once it is a wish.
    factsFor: (p) => {
      const hit = p.osmId ? byOsm.get(p.osmId) : undefined;
      return hit?.facts ?? (hit?.place ? { ...emptyFacts('brief', null) } : null);
    },
  };
}

interface Tried {
  ops: TripOp[];
  result: DryRunResult;
  signature: string;
}

async function tryOps(base: Base, ops: unknown[], resolve: boolean, destination: string): Promise<Tried> {
  const result = await dryRun(base.run, ops, {
    trustsPlaces: true,
    baseline: base.baseline,
    titles: base.titles,
    factsFor: (p) => base.factsFor({ osmId: p.osmId, name: p.name }),
    // Only the planner's own drafts name places by query; rule drafts carry them.
    ...(resolve
      ? {
          resolvePlace: async (q: string, near: LatLng | null) => {
            const p = await findPlaceLoosely(q, destination, near).catch(() => null);
            return p ? { name: p.name, location: p.location, osmId: p.osmId, address: p.address } : null;
          },
        }
      : {}),
  });
  return { ops: result.applied, result, signature: planSignature(result.plan, result.input.trip) };
}

interface Checked {
  draft: Draft;
  answers: Array<{ label: string; ops: TripOp[]; brief: QuestionAnswer['brief']; remember: string | null; tried: Tried }>;
  defaultIndex: number;
  impact: number;
  dates: LocalDate[];
  stops: number;
}

/**
 * Dry-run every answer. Null when fewer than two answers survive (an answer
 * whose ops could not be applied is dropped) or when they all solve to the
 * same plan.
 */
async function check(draft: Draft, base: Base, trip: TripRecord, today: LocalDate): Promise<Checked | null> {
  const answers: Checked['answers'] = [];
  let defaultIndex = 0;
  for (const [i, a] of draft.answers.entries()) {
    const ops = [...briefPatchOps(a.brief ?? null), ...(a.ops as TripOp[])];
    const tried = await tryOps(base, ops, draft.origin === 'planner', trip.destination);
    // Ops asked for but none applied: not an answer we can give.
    if (ops.length && !tried.ops.length) continue;
    if (i === draft.defaultIndex) defaultIndex = answers.length;
    answers.push({ label: a.label, ops: tried.ops, brief: a.brief ?? null, remember: a.remember ?? null, tried });
  }
  if (answers.length < 2) return null;
  if (new Set(answers.map((a) => a.tried.signature)).size < 2) return null;
  const stops = Math.max(...answers.map((a) => a.tried.result.diff.changes.length));
  const dates = [...new Set(answers.flatMap((a) => a.tried.result.diff.dates))].sort();
  return { draft, answers, defaultIndex, impact: stops * urgency(draft.deadline ?? null, today), dates, stops };
}

/** Comparable answers of a stored question, for "re-ask a skipped one only if its answers changed". */
const answersKey = (answers: Array<Pick<QuestionAnswer, 'label' | 'summary' | 'changes'>>) => JSON.stringify(answers.map((a) => [a.label, a.summary, a.changes]));

// One check at a time per trip: two refreshes racing would ask the same thing twice.
const locks = new Map<string, Promise<unknown>>();
function serial<T>(tripId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(tripId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const settled = next.catch(() => undefined);
  locks.set(tripId, settled);
  void settled.then(() => {
    if (locks.get(tripId) === settled) locks.delete(tripId);
  });
  return next;
}

/** Tests only: wait for every check in flight (an answer refreshes questions in the background). */
export async function questionsSettledForTest(): Promise<void> {
  while (locks.size) await Promise.all([...locks.values()]);
}

/**
 * The shared check: dry-run, drop what changes nothing, never repeat an
 * open or answered key nor re-ask a skipped one whose answers are the same,
 * rank by impact, keep the top MAX_OPEN_QUESTIONS open per audience, apply
 * the assumed answer where it changes the plan, store.
 */
/**
 * `assume`: whether the assumed answer may be applied straight away. Only
 * while a trip is being shaped (the guided start) or in a turn the person is
 * having with the planner — never from a background refresh, which would
 * change a trip already planned (days before Rome) with nobody asking.
 */
async function checkDrafts(trip: TripRecord, drafts: Draft[], opts: { assume: boolean } = { assume: true }): Promise<Question[]> {
  if (!drafts.length) return [];
  let base = await loadBase(trip);
  if (!base) return [];
  const today = localDateIn(trip.timeZone, new Date());
  const [keys, open, skipped] = await Promise.all([questionKeys(trip.id), listQuestions(trip.id, { status: ['open'], limit: 50 }), listQuestions(trip.id, { status: ['skipped'], limit: 50 })]);
  const candidates: Checked[] = [];
  for (const d of drafts) {
    const status = keys.get(d.key);
    if (status === 'open' || status === 'answered') continue;
    const c = await check(d, base, trip, today);
    if (!c) continue;
    if (status === 'skipped') {
      const before = skipped.find((q) => q.key === d.key);
      const now = c.answers.map((a) => ({ label: a.label, summary: answerSummary(a.tried.result.diff), changes: a.tried.result.diff.changes.length }));
      if (before && answersKey(before.answers) === answersKey(now)) continue;
    }
    candidates.push(c);
  }
  candidates.sort((a, b) => b.impact - a.impact || a.draft.key.localeCompare(b.draft.key));

  const openBy = new Map<QuestionAudience, number>();
  for (const q of open) openBy.set(q.audience, (openBy.get(q.audience) ?? 0) + 1);
  const stored: Question[] = [];
  let applied = false;
  for (let c of candidates) {
    const audience = c.draft.audience ?? 'owner';
    if ((openBy.get(audience) ?? 0) >= MAX_OPEN_QUESTIONS) continue;
    // A default applied for an earlier question moved the plan: check again.
    if (applied) {
      const again = await check(c.draft, base, trip, today);
      if (!again) continue;
      c = again;
    }
    const def = c.answers[c.defaultIndex];
    let appliedDefault = def.tried.signature === base.signature;
    let answers = c.answers.map((a) => ({ ...a, inverse: [] as TripOp[] }));
    // Assume-and-ask: the plan uses the assumption from now on.
    if (opts.assume && !appliedDefault && c.draft.assume !== false && def.ops.length && canInvert(def.ops)) {
      const before = base.snapshot;
      const r = await applyAndReplan(trip, def.ops, { surface: 'site', eventText: `Assumed for now: ${def.label} — ${c.draft.prompt}`, trustedPlaces: true });
      if (r.applied.length) {
        const after = await loadState(trip.id);
        const inverse = inverseOps(r.applied, before, after);
        const fresh = (await getTripById(trip.id)) ?? trip;
        await recordProvenance(trip.id, r.applied, before, after, 'assumed', `Assumed: ${def.label}`);
        base = (await loadBase(fresh)) ?? base;
        applied = true;
        appliedDefault = true;
        // Every other answer first puts the assumption back.
        const redo: typeof answers = [];
        for (const [i, a] of c.answers.entries()) {
          if (i === c.defaultIndex) {
            redo.push({ ...a, ops: [], inverse: [], tried: await tryOps(base, [], false, trip.destination) });
            continue;
          }
          const ops = [...(inverse ?? []), ...a.ops];
          redo.push({ ...a, ops, inverse: inverse ?? [], tried: await tryOps(base, ops, false, trip.destination) });
        }
        answers = redo;
      }
    }
    const affects = { dates: [...new Set(answers.flatMap((a) => a.tried.result.diff.dates))].sort(), stops: Math.max(0, ...answers.map((a) => a.tried.result.diff.changes.length)) };
    const q = await addQuestion(trip.id, {
      key: c.draft.key,
      origin: c.draft.origin,
      prompt: c.draft.prompt,
      why: c.draft.why ?? whyLine(affects.dates, affects.stops),
      answers: answers.map((a, i) => ({
        id: `a${i}`,
        label: a.label,
        ops: a.ops,
        brief: a.brief,
        remember: a.remember,
        summary: i === c.defaultIndex && appliedDefault ? null : answerSummary(a.tried.result.diff),
        changes: i === c.defaultIndex && appliedDefault ? 0 : a.tried.result.diff.changes.length,
      })),
      defaultAnswerId: `a${c.defaultIndex}`,
      appliedDefault,
      // Only promise the assumption when the plan already has it.
      ifSkipped: appliedDefault ? (c.draft.ifSkipped ?? `If you skip: ${def.label.toLowerCase()}.`) : 'If you skip: the plan stays as it is.',
      affects,
      impact: c.impact,
      audience,
      deadline: c.draft.deadline ?? null,
      basedOnVersion: base.latest.version,
    });
    openBy.set(audience, (openBy.get(audience) ?? 0) + 1);
    stored.push(q);
  }
  return stored;
}

async function recordProvenance(tripId: string, ops: TripOp[], before: Pick<Snapshot, 'stays' | 'wishes' | 'bookings'>, after: Pick<Snapshot, 'stays' | 'wishes' | 'bookings'>, source: 'you' | 'assumed', note: string | null): Promise<void> {
  const keys = provenanceKeys(ops, before, after);
  if (!keys.length) return;
  await noteProvenance(tripId, Object.fromEntries(keys.map((k) => [k, { source, note, ref: null }]))).catch((err) => console.warn('[trips/questions] provenance not recorded:', (err as Error)?.message));
}

/** Check the planner's (or a rule's) drafts: dry-run each answer, drop the ones that change nothing, store the rest. */
export async function checkQuestionDrafts(trip: TripRecord, drafts: QuestionDraft[], _opts: { authorEmail?: string | null } = {}): Promise<Question[]> {
  try {
    const added = await serial(trip.id, () => checkDrafts(trip, drafts));
    if (added.length) void pushQuestions(trip, added);
    return added;
  } catch (err) {
    console.warn('[trips/questions] could not check the drafts:', (err as Error)?.message);
    return [];
  }
}

/** Open groups of alternatives (shapes, day versions), each solved for its score. */
async function alternativesOf(tripId: string, base: Base): Promise<Alternatives[]> {
  const open = await listProposals(tripId, { status: ['open'], limit: 30 }).catch(() => []);
  const groups = new Map<string, Alternatives>();
  for (const p of open) {
    if (p.kind !== 'shape' && p.kind !== 'day') continue;
    const g = groups.get(p.groupId) ?? { groupId: p.groupId, kind: p.kind, date: p.scope.date, items: [] };
    g.items.push({ id: p.id, title: p.title, ops: p.ops, score: 0 });
    groups.set(p.groupId, g);
  }
  const out: Alternatives[] = [];
  for (const g of groups.values()) {
    if (g.items.length < 2) continue;
    for (const item of g.items) item.score = (await tryOps(base, item.ops, false, '')).result.plan.score;
    out.push(g);
  }
  return out;
}

const reasonOf = (r: string | null): RejectReason | null => {
  if (!r) return null;
  if ((REJECT_REASONS as readonly string[]).includes(r)) return r as RejectReason;
  const byLabel = Object.entries(REJECT_REASON_LABEL).find(([, label]) => r.toLowerCase().startsWith(label.toLowerCase()));
  return byLabel ? (byLabel[0] as RejectReason) : null;
};

/**
 * Re-run the rule-based generators after the plan changed (a turn, an
 * accepted proposal, an answer, research finishing): add questions that now
 * matter, expire ones whose answers no longer differ. Never throws.
 */
export async function refreshQuestions(trip: TripRecord, _opts: { reason?: string } = {}): Promise<Question[]> {
  try {
    const added = await serial(trip.id, async () => {
      const fresh = (await getTripById(trip.id)) ?? trip;
      const base = await loadBase(fresh);
      if (!base) return [];
      const today = localDateIn(fresh.timeZone, new Date());
      // Expire open questions whose answers now solve the same — and a tie whose alternatives were decided elsewhere.
      const openProposals = await listProposals(fresh.id, { status: ['open'], limit: 30 }).catch(() => []);
      for (const q of await listQuestions(fresh.id, { status: ['open'], limit: 50 })) {
        if (q.origin === 'tie' && !q.answers.some((a) => openProposals.some((p) => sameOps(p.ops, a.ops.slice(-p.ops.length))))) {
          await closeQuestion(fresh.id, q.id, 'expired', { answerId: null, byEmail: null, byName: null });
          continue;
        }
        const sigs = new Set<string>();
        let usable = 0;
        for (const a of q.answers) {
          const tried = await tryOps(base, a.ops, false, fresh.destination);
          if (a.ops.length && !tried.ops.length) continue;
          usable++;
          sigs.add(tried.signature);
        }
        if (usable < 2 || sigs.size < 2) await closeQuestion(fresh.id, q.id, 'expired', { answerId: null, byEmail: null, byName: null });
      }
      const [places, pack, rejectedProposals] = await Promise.all([listPackPlaces(fresh.id).catch(() => []), readPack(fresh.id), listProposals(fresh.id, { status: ['rejected'], limit: 30 }).catch(() => [])]);
      const kindOf = (packPlaceId: string | null) => places.find((p) => p.id === packPlaceId)?.kind ?? null;
      const rejected = [
        ...rejectedProposals.map((p) => ({ reason: reasonOf(p.reason), kind: kindOf(p.packPlaceId), title: p.title })),
        ...places.filter((p) => p.status === 'rejected').map((p) => ({ reason: p.rejectReason, kind: p.kind, title: p.name })),
      ].filter((r): r is { reason: RejectReason; kind: ReturnType<typeof kindOf>; title: string } => !!r.reason);
      const drafts = generateQuestions({
        trip: base.snapshot.trip,
        stays: base.snapshot.stays,
        wishes: base.snapshot.wishes,
        bookings: base.snapshot.bookings,
        profile: fresh.profile,
        plan: base.baseline,
        places,
        calendar: pack.calendar,
        rejected,
        alternatives: await alternativesOf(fresh.id, base),
        today,
      });
      return checkDrafts(fresh, drafts, { assume: _opts.reason === 'start' });
    });
    if (added.length) void pushQuestions(trip, added);
    return added;
  } catch (err) {
    console.warn('[trips/questions] refresh failed:', (err as Error)?.message);
    return [];
  }
}

// ── Answering ──────────────────────────────────────────────────────────────

export type QuestionAction = { action: 'answer'; answerId: string } | { action: 'decide' } | { action: 'skip' } | { action: 'vote'; answerId: string };

export function parseQuestionAction(body: unknown): QuestionAction | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const id = typeof b.answerId === 'string' && /^a\d$/.test(b.answerId) ? b.answerId : null;
  if (b.action === 'answer' && id) return { action: 'answer', answerId: id };
  if (b.action === 'vote' && id) return { action: 'vote', answerId: id };
  if (b.action === 'decide') return { action: 'decide' };
  if (b.action === 'skip') return { action: 'skip' };
  return null;
}

export interface QuestionCaller {
  email: string;
  /** Display name for "answered by" and votes; never an email. */
  name: string;
  /** The site owner: only they are offered `remember` (memory is the owner's). */
  isOwner: boolean;
  access: Pick<TripAccess, 'role' | 'canEdit' | 'canApprove'>;
  surface: 'site' | 'phone';
}

export interface AnswerResult {
  question: Question;
  planVersion: number | null;
  changes: string[];
  diff: PlanDiff;
  undo: { toVersion: number } | null;
  remember: string | null;
}

type Outcome = { status: number; body: AnswerResult | { error: string; question?: Question } };

/** Who may decide a question: its audience, and for a family question only a parent or the creator. */
function mayDecide(q: Question, access: QuestionCaller['access']): boolean {
  if (!audiencesFor(access).includes(q.audience)) return false;
  return q.audience !== 'family' || access.role === 'creator' || access.canApprove;
}

export async function answerQuestion(trip: TripRecord, qid: string, act: QuestionAction, caller: QuestionCaller): Promise<Outcome> {
  const q = await getQuestion(trip.id, qid);
  if (!q || !audiencesFor(caller.access).includes(q.audience)) return { status: 404, body: { error: 'No such question.' } };
  const latest = await latestPlan(trip.id);
  const still = (question: Question): AnswerResult => ({ question, planVersion: latest?.version ?? null, changes: [], diff: EMPTY_DIFF, undo: null, remember: null });
  if (q.status !== 'open') return { status: 409, body: { error: 'That question has already been answered.', question: q } };

  // A family member's tap on a family question is a vote; a parent decides.
  if (act.action === 'vote' || (act.action === 'answer' && q.audience === 'family' && !mayDecide(q, caller.access))) {
    if (q.audience !== 'family') return { status: 400, body: { error: 'Only family questions take votes.' } };
    if (!q.answers.some((a) => a.id === act.answerId)) return { status: 400, body: { error: 'No such answer.' } };
    const voted = await voteQuestion(trip.id, q.id, act.answerId, { email: caller.email, name: caller.name });
    if (!voted) return { status: 409, body: { error: 'That question has already been answered.', question: q } };
    return { status: 200, body: still(voted) };
  }
  if (!mayDecide(q, caller.access)) return { status: 403, body: { error: 'A parent decides this one.' } };

  if (act.action === 'skip') {
    if (!(await closeQuestion(trip.id, q.id, 'skipped', { answerId: null, byEmail: caller.email, byName: caller.name }))) return { status: 409, body: { error: 'Someone got there first.' } };
    return { status: 200, body: still((await getQuestion(trip.id, q.id)) ?? q) };
  }

  const answerId = act.action === 'decide' ? q.defaultAnswerId : act.answerId;
  const answer = q.answers.find((a) => a.id === answerId);
  if (!answer) return { status: 400, body: { error: 'No such answer.' } };
  // Claim it first: two people answering at once must not both change the plan.
  if (!(await closeQuestion(trip.id, q.id, 'answered', { answerId, byEmail: caller.email, byName: caller.name }))) return { status: 409, body: { error: 'Someone got there first.' } };
  const closed = (await getQuestion(trip.id, q.id)) ?? q;
  const remember = caller.isOwner ? answer.remember : null;
  const ops = [...briefPatchOps(answer.brief), ...answer.ops];
  if (!ops.length) {
    void refreshQuestions(trip, { reason: 'answer' });
    return { status: 200, body: { ...still(closed), remember } };
  }

  const before = await loadState(trip.id);
  const r = await applyAndReplan(trip, ops, { surface: caller.surface, eventText: `${caller.name} answered “${q.prompt}”: ${answer.label}.`, trustedPlaces: true });
  const after = await loadState(trip.id);
  await recordProvenance(trip.id, r.applied, before, after, 'you', null);
  const now = await latestPlan(trip.id);
  const moved = !!now && (!latest || now.version !== latest.version);
  const titles = Object.fromEntries([...before.wishes, ...after.wishes].map((w) => [w.id, w.title]));
  const diff = moved && now ? planDiff(latest?.plan ?? null, now.plan, titles) : EMPTY_DIFF;

  // A tie between shapes (or day versions) answered here takes that proposal.
  if (q.origin === 'tie') await takeAlternative(trip.id, answer, caller.email).catch((err) => console.warn('[trips/questions] could not close the alternatives:', (err as Error)?.message));
  void refreshQuestions(trip, { reason: 'answer' });
  return {
    status: 200,
    body: {
      question: closed,
      planVersion: r.planVersion,
      changes: moved && now ? now.changes : [],
      diff,
      undo: moved && latest ? { toVersion: latest.version } : null,
      remember,
    },
  };
}

/** The open proposal whose ops are this answer's: accepted; the rest of its group superseded (shapes: expired). */
const sameOps = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function takeAlternative(tripId: string, answer: QuestionAnswer, email: string): Promise<void> {
  const open = await listProposals(tripId, { status: ['open'], limit: 30 });
  const hit = open.find((p) => (p.kind === 'shape' || p.kind === 'day') && sameOps(p.ops, answer.ops.slice(-p.ops.length)));
  if (!hit) return;
  if (!(await decideProposal(tripId, hit.id, 'accepted', null, email))) return;
  await supersedeGroup(tripId, hit.groupId, hit.id, `Chose ${hit.title}`);
  if (hit.kind === 'shape') await expireProposals(tripId, ['shape'], `Chose ${hit.title}`);
}

// ── Pushes ─────────────────────────────────────────────────────────────────

/** The routing key the app's tap handler reads; the APNs category carries the question's own answers. */
export const QUESTION_PUSH_CATEGORY = 'trip-question';

async function audienceEmails(trip: TripRecord, audience: QuestionAudience): Promise<string[]> {
  if (audience === 'owner') return [trip.ownerEmail.trim().toLowerCase()];
  const { familyRoster } = await import('$lib/family/roster.server');
  const roster = await familyRoster().catch(() => []);
  const people = audience === 'parents' ? roster.filter((p) => p.parent) : roster;
  return [...new Set([...people.map((p) => p.email), ...getOwnerEmails(), trip.ownerEmail].map((e) => e.trim().toLowerCase()))].filter(Boolean);
}

export function questionPush(trip: Pick<TripRecord, 'id' | 'title'>, q: Pick<Question, 'id' | 'prompt' | 'answers'>): PushMessage {
  const answers = q.answers.map((a) => ({ id: a.id, label: a.label }));
  return {
    title: `${trip.title} · quick question`,
    body: q.prompt,
    // aps.category: the app registers `trip-q-<id>` with this question's real
    // answers as buttons when it loads the bundle (one category per open
    // question); unregistered, iOS shows it plainly and a tap opens the
    // question by `url`. The buttons answer through POST …/questions/:qid.
    category: `trip-q-${q.id}`,
    threadId: `trip-${trip.id}`,
    level: 'active',
    relevance: 0.6,
    collapseId: `trip-q-${q.id}`.slice(0, 64),
    userInfo: {
      category: QUESTION_PUSH_CATEGORY,
      url: `sr://trips/${trip.id}/questions/${q.id}`,
      tripId: trip.id,
      questionId: q.id,
      prompt: q.prompt,
      // APNs carries userInfo as JSON, so the list travels as a list.
      answers: answers as unknown as string,
    },
  };
}

/**
 * At most one question notification per trip per day, and only before the
 * trip: the most important of the new ones, to its audience. Never throws.
 */
export async function pushQuestions(trip: TripRecord, added: Question[], opts: { push?: typeof pushToEmails; now?: Date } = {}): Promise<number> {
  try {
    const now = opts.now ?? new Date();
    const today = localDateIn(trip.timeZone, now);
    if (today >= trip.startDate || !added.length) return 0;
    const last = await lastQuestionPush(trip.id);
    if (last && localDateIn(trip.timeZone, last) === today) return 0;
    const q = [...added].sort((a, b) => b.impact - a.impact)[0];
    const to = await audienceEmails(trip, q.audience);
    if (!to.length) return 0;
    const sent = (await (opts.push ?? pushToEmails)(to, questionPush(trip, q))).sent;
    if (sent) await markQuestionPushed(trip.id, q.id);
    return sent;
  } catch (err) {
    console.warn('[trips/questions] push failed:', (err as Error)?.message);
    return 0;
  }
}

/** "Tue 27 Oct" — re-exported for callers that word a deadline. */
export const deadlineLabel = (d: LocalDate) => dayLabel(d);
