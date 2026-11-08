// src/lib/trips/converse.server.ts
//
// One turn of the planning conversation (v2). The person says something; ONE
// call on the `trips-planner` workload reads the trip and answers with
// `{ reply, ops, quickReplies }`; the ops are validated and applied in order
// (./ops); the trip re-solves once; both messages are stored; the turn's
// `ConverseResult` goes back to the page or the phone.
//
// v8 (propose, research, ask): the planner ACTS (small, clear ops — the turn
// returns the difference and the version Undo goes back to), PROPOSES
// (alternatives, or a large change to approve — checked and stored, see
// ./proposals.server) or ASKS (a question card with the assumption already
// applied — S2's ./questions.server). It sees the brief with where each fact
// came from, the research pack's candidates and what is already open, and
// labels each fact it sets (./provenance). A reply that promises ideas and
// carries nothing gets one corrective retry, then a plain sentence and what
// the pack can offer. Every old field of the result is still there, and the
// legacy option cards are drawn from the proposals for the current app.
//
// No model reachable is an ordinary state on a host without a key: the
// person's message is still stored, the reply says the planner is not
// available, and the forms keep working.

import { checkOptions } from './options.server';
import type { PlanOption } from './options';
import { diffPlans } from './changes';
import { CHECK_SYSTEM, checkPrompt, readCheck, turnDiff } from './check';
import type { ConverseResult, LatLng, Observation, ResearchStep, SolvedPlan, TripMessage, TripOp } from './model';
import { agentTurn } from './agent.server';
import { gatherProfile, rememberStated, saveProfile } from './profile.server';
import { travellersOnly } from './profile';
import { parseLooseJson } from './research';
import { jsonCall } from './llm.server';
import { CHECK_CALL_MS } from './limits';
import { applyOps, knownUrlsOf, readPlannerAnswer, urlsIn, type ApplyResult, type OpEffects, type PlannerAnswer } from './ops';
import { emptyPromise, type PackPlace, type Proposal, type Provenance, type Question } from './decisions';
import { listPackPlaces, listProposals, listQuestions, noteProvenance, readProvenance } from './decisions.store.server';
import { phoneBrief } from './decisions.bundle.server';
import { buildBrief } from './brief';
import { briefNow } from './brief.server';
import { planDiff } from './dryrun';
import { ensurePack } from './pack.server';
import { openSlot, optionDrafts } from './proposals';
import { checkDrafts, offerFromPack } from './proposals.server';
import { captureCreated, pairApplied, provenanceFor, type CreatedIds, withoutInventedFacts } from './provenance';
import { checkQuestionDrafts, refreshQuestions } from './questions.server';
import { localDateIn } from './routing';
import { replan } from './plan.server';
import { EMPTY_PROMISE_CORRECTION, missingInfo, PACK_IN_PROMPT, plannerMessages, type PlannerContext } from './prompt';
import { findPlace, findPlaceLoosely, startResearch, suggestNearby } from './research.server';
import {
  addMessage,
  addStay,
  addTransport,
  deleteTransport,
  listTransport,
  updateTransport,
  addWishes,
  deleteStay,
  deleteWish,
  getTrip,
  latestPlan,
  loadState,
  recentMessages,
  viewerOf,
  saveBooking,
  updateStay,
  updateTrip,
  updateWish,
  tripOnly,
  type TripRecord,
} from './store.server';

/** How long a turn waits for its options to be placed and checked. */
const OPTIONS_DEADLINE_MS = 20_000;

export const NO_PLANNER =
  'I can’t reach the planning model just now, so I couldn’t act on that. Your message is saved — try again shortly, or change the trip directly in the details.';

export interface ConverseInput {
  text: string;
  /**
   * 'jkai': the turn came through jkai's trip tools (overhaul plan 2026-10-28,
   * P2-4). It is planned exactly as a site turn — the stored messages are
   * labelled 'jkai' so the trip page can say where they came from.
   */
  surface: 'site' | 'phone' | 'jkai';
  /**
   * v5: who is talking. The owner's memory (the full profile, `remember`) is
   * used only when `isOwner`; someone who cannot edit gets advice only — the
   * planner's ops are not applied. Default: the site's owner, who may edit.
   */
  caller?: { isOwner: boolean; canEdit: boolean; name: string | null; email?: string; personId?: string | null };
  observation?: Observation | null;
  position?: LatLng | null;
}

export interface ConverseTurn extends ConverseResult {
  messages: TripMessage[];
}

function nowText(timeZone: string, now = new Date()): string {
  return now.toLocaleString('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** The effects the ops may have, bound to one trip (and the message that asked, for `remember`). */
function effectsFor(trip: TripRecord, messageId: string | null = null, ownerEmail: string | null = trip.ownerEmail): OpEffects {
  return {
    addTransport: (seg) => addTransport(trip.id, seg),
    updateTransport: (id, fields) => updateTransport(trip.id, id, fields),
    removeTransport: async (id) => void (await deleteTransport(trip.id, id)),
    // Only the owner's own statements are remembered (and only into the owner's memory).
    ...(ownerEmail
      ? {
          remember: async (text: string, category: 'preferences' | 'people' | 'health' | 'places') => {
            if (!messageId) throw new Error('remember needs the message it came from');
            return rememberStated({ text, category, messageId, ownerEmail });
          },
        }
      : {}),
    saveProfile: (profile) => saveProfile(trip.id, profile),
    resolvePlace: async (query, near) => {
      const p = await findPlaceLoosely(query, trip.destination, near);
      return p ? { name: p.name, location: p.location, osmId: p.osmId, address: p.address } : null;
    },
    setTrip: (fields) => updateTrip(trip.id, fields),
    addStay: (s) => addStay(trip.id, s),
    updateStay: (id, fields) => updateStay(trip.id, id, fields),
    removeStay: async (id) => void (await deleteStay(trip.id, id)),
    addWish: async (w) => {
      const [wish] = await addWishes(trip.id, [{ ...w, suggested: false, place: w.place }]);
      return wish;
    },
    updateWish: async (id, patch) => void (await updateWish(trip.id, id, patch)),
    removeWish: async (id) => void (await deleteWish(trip.id, id)),
    addBooking: async (b) => {
      const { wishId, title, ...patch } = b;
      const saved = await saveBooking(trip.id, { bookingId: null, wishId, title }, { ...patch, title });
      if (!saved) throw new Error('booking insert failed');
      return saved;
    },
    updateBooking: async (id, patch) => void (await saveBooking(trip.id, { bookingId: id, wishId: null, title: '' }, patch)),
  };
}

export async function converse(trip: TripRecord, input: ConverseInput): Promise<ConverseTurn> {
  const text = input.text.trim().slice(0, 4000);
  const caller = input.caller ?? { isOwner: true, canEdit: true, name: null };
  // Advice only (v5): someone who cannot edit gets the reply — never ops, and (v8) never proposals or questions.
  const editor = caller.canEdit;
  // Where the turn was planned from: jkai plans as the site does.
  const planSurface: 'site' | 'phone' = input.surface === 'phone' ? 'phone' : 'site';
  // v5: the turn belongs to its speaker's own thread; the model sees only
  // that thread and the plan changes everyone sees — never another person's chat.
  const author = { email: (caller.email ?? trip.ownerEmail).trim().toLowerCase(), id: caller.personId ?? null };
  const [state, latest, history, transport, provenance, pack, openProposals, openQuestions] = await Promise.all([
    loadState(trip.id),
    latestPlan(trip.id),
    recentMessages(trip.id, viewerOf(trip, author.email), 30),
    listTransport(trip.id),
    // v8: where each fact came from, the research pack, and what is already open.
    readProvenance(trip.id).catch(() => ({}) as Provenance),
    listPackPlaces(trip.id, { status: ['candidate'] }).catch(() => [] as PackPlace[]),
    editor ? listProposals(trip.id, { status: ['open'] }).catch(() => [] as Proposal[]) : Promise.resolve([] as Proposal[]),
    listQuestions(trip.id, { status: ['open'] }).catch(() => [] as Question[]),
  ]);
  // What the planner already knows (v3): gathered once, on the owner's first
  // turn. Anyone else's prompt gets the travellers alone (v5): the owner's
  // memory never reaches another family member.
  const profile = caller.isOwner
    ? (trip.profile ?? (await gatherProfile(trip, { asOwner: true, ownerEmail: caller.email ?? trip.ownerEmail }).catch(() => null)))
    : travellersOnly(trip.profile);
  const userAt = new Date();
  const userMessage = await addMessage(trip.id, { role: 'user', text, ops: [], planVersion: null, surface: input.surface, at: userAt, author });

  // v8: the brief as this caller may see it (the owner's notes only for the owner).
  const brief = buildBrief({ trip: tripOnly(trip), stays: state.stays, wishes: state.wishes, bookings: state.bookings, transport, profile, provenance, missing: missingInfo(trip, state.stays, state.wishes) });
  const audiences = caller.isOwner ? ['owner', 'parents', 'family'] : editor ? ['parents', 'family'] : ['family'];
  const ctx: PlannerContext = {
    trip,
    stays: state.stays,
    wishes: state.wishes,
    bookings: state.bookings,
    plan: latest?.plan ?? null,
    planVersion: latest?.version ?? null,
    messages: history,
    nowText: nowText(trip.timeZone),
    surface: planSurface,
    observation: input.observation ?? null,
    position: input.position ?? null,
    transport,
    profile,
    adviceOnly: !editor,
    callerName: caller.name,
    brief: caller.isOwner ? brief : phoneBrief(brief),
    pack: pack.slice(0, PACK_IN_PROMPT),
    openProposals,
    openQuestions: openQuestions.filter((q) => audiences.includes(q.audience)),
  };

  // The agentic turn (v3): the planner may look things up first, within its budget.
  let answer: PlannerAnswer | null = null;
  let lookups: ResearchStep[] = [];
  let seenUrls: string[] = [];
  try {
    const turn = await agentTurn(plannerMessages(ctx, text, { agentic: true }) as Array<Record<string, unknown>>, { trip, stays: state.stays, wishes: state.wishes });
    lookups = turn.research;
    seenUrls = turn.seenUrls;
    const parsed = parseLooseJson(turn.reply);
    if (parsed && typeof parsed === 'object') answer = readPlannerAnswer(parsed);
    else if (turn.reply.trim()) answer = readPlannerAnswer(turn.reply.trim());
  } catch (err) {
    console.warn('[trips/converse] planner unavailable:', (err as Error)?.message);
  }

  if (!answer) {
    const reply = await addMessage(trip.id, { role: 'assistant', text: NO_PLANNER, ops: [], planVersion: null, surface: input.surface, at: new Date(userAt.getTime() + 1), research: lookups, author });
    return { reply: NO_PLANNER, applied: [], rejected: [], quickReplies: [], planVersion: latest?.version ?? null, changes: [], research: lookups, messages: [userMessage, reply] };
  }

  // v8: Darlington's "I've added a few ideas" with nothing added. A reply
  // that promises ideas or changes must carry them: one corrective retry;
  // if it still carries nothing, the reply is replaced further down.
  let stillEmpty = false;
  if (editor && promisesNothing(answer)) {
    const retry = await correctiveRetry(ctx, text, answer);
    if (retry && !promisesNothing(retry)) answer = retry;
    else stillEmpty = true;
  }

  const known = knownUrlsOf(state.wishes, [
    ...(trip.guide?.taxi?.links ?? []).map((l) => l.url),
    ...urlsIn(text),
    ...history.filter((m) => m.role === 'user').flatMap((m) => urlsIn(m.text)),
    ...seenUrls,
  ]);
  const memoryOwner = caller.isOwner ? (caller.email ?? trip.ownerEmail) : null;
  // Advice only (v5): a family member who cannot edit gets the reply, never the ops.
  // v8: never a guessed stay or booking — the brief shows "not known yet" instead.
  const vetted = withoutInventedFacts(editor ? answer.ops : []);
  if (vetted.dropped.length) console.info('[trips/converse] dropped invented facts:', vetted.dropped.join('; '));
  const firstOps = vetted.ops;
  const cap = captureCreated(effectsFor(trip, userMessage.id, memoryOwner));
  const result = await applyOps(firstOps, { trip, stays: state.stays, wishes: state.wishes, bookings: state.bookings, knownUrls: known, transport, profile }, cap.fx);
  // v8: each fact the planner set is labelled with where it came from ('assumed' unless it said).
  await recordPlannerProvenance(trip.id, firstOps, result, cap.created);
  const before: SolvedPlan | null = latest?.plan ?? null;
  const source = input.surface === 'phone' ? 'phone' : 'site';
  // A change asked for on the phone is the phone's own version of today: it is
  // not held back by the running-day rule.
  const solve = async (): Promise<{ version: number; plan: SolvedPlan } | null> => {
    const fresh = (await getTrip(trip.ownerEmail, trip.id)) ?? trip;
    try {
      const solved = await replan(fresh, source, { keepRunningDay: input.surface !== 'phone' });
      return { version: solved.plan.version, plan: solved.plan.plan };
    } catch (err) {
      console.error('[trips/converse] re-plan failed:', err);
      return null;
    }
  };

  let planVersion = latest?.version ?? null;
  let finalPlan: SolvedPlan | null = before;
  let replyText = answer.reply;
  let solveFailed = false;
  const applied: TripOp[] = [...result.applied];
  const rejected = [...result.rejected];
  const research = [...result.research];
  const suggest = [...result.suggest];
  let changed = result.changed;

  if (result.changed) {
    const solved = await solve();
    if (solved) {
      planVersion = solved.version;
      finalPlan = solved.plan;
      // Check and correct (v2.1): the second and last model call of the turn.
      const correction = await checkAndCorrect(trip, text, answer.reply, result, before, solved.plan, known, userMessage.id, memoryOwner);
      if (correction) {
        if (correction.reply) replyText = correction.reply;
        if (correction.result) {
          applied.push(...correction.result.applied);
          rejected.push(...correction.result.rejected);
          research.push(...correction.result.research);
          suggest.push(...correction.result.suggest);
          if (correction.result.changed) {
            changed = true;
            const again = await solve();
            if (again) {
              planVersion = again.version;
              // The correction is not checked again (two calls per turn), so
              // what it could not do is stated from the solver, not the model.
              replyText += correctionNote(solved.plan, again.plan, Object.fromEntries((await loadState(trip.id)).wishes.map((w) => [w.id, w.title])));
              finalPlan = again.plan;
            } else solveFailed = true;
          }
        }
      }
    } else solveFailed = true;
  }
  const { wishes: titlesNow } = await loadState(trip.id);
  const titles = Object.fromEntries(titlesNow.map((w) => [w.id, w.title]));
  const changes = solveFailed
    ? ['The changes are saved, but the plan could not be rebuilt just now.']
    : changed && finalPlan
      ? diffPlans(before, finalPlan, titles)
      : [];
  // The trip as the turn left it (dates, pace — and the profile, which `remember` changes without a re-solve).
  const fresh = applied.length ? ((await getTrip(trip.ownerEmail, trip.id)) ?? trip) : trip;

  // Research and suggestions run after the turn, in the background.
  const ids = [...new Set(research.flatMap((r) => r.wishIds))];
  if (ids.length) {
    void startResearch(trip.ownerEmail, trip.id, {
      wishIds: ids,
      depth: research.some((r) => r.depth === 'deep') ? 'deep' : 'brief',
      onDone: async (id) => {
        const t = await getTrip(trip.ownerEmail, id);
        if (!t) return;
        const again = await replan(t, 'research');
        // v8: nothing changes silently — a re-plan that moved things says so.
        const note = again.created ? backgroundNote(again.plan.changes) : null;
        if (note) await logEdit(id, note, [], again.plan.version);
      },
    }).catch((err) => console.warn('[trips/converse] research did not start:', (err as Error)?.message));
  }
  for (const s of suggest.slice(0, 1)) {
    void (async () => {
      const near = s.near ? (await findPlace(/,/.test(s.near) ? s.near : `${s.near}, ${trip.destination}`, null))?.location ?? null : (input.position ?? null);
      await suggestNearby(trip.id, near);
    })().catch((err) => console.warn('[trips/converse] suggestions failed:', (err as Error)?.message));
  }
  // v8: a new destination or new dates: the research pack is rebuilt for them.
  if (applied.some((o) => o.op === 'setTrip' && ('destination' in o.fields || 'startDate' in o.fields || 'endDate' in o.fields))) {
    void Promise.resolve()
      .then(() => ensurePack(fresh, { reason: 'changed' }))
      .catch((err) => console.warn('[trips/converse] research pack not started:', (err as Error)?.message));
  }

  // v8: proposals — the planner's own, and v7's options read as a fill group
  // — each dry-run against the plan as it now stands and stored. A turn may
  // act AND propose. The legacy option cards (for the family's current app,
  // which ignores proposals) are drawn from the fill and swap groups, on a
  // turn that changed nothing, as v7's options always were.
  const proposer = { email: author.email, name: caller.name, personId: author.id, isOwner: caller.isOwner, surface: planSurface };
  let proposals: Proposal[] = [];
  let legacy: PlanOption[] = [];
  const drafts = editor ? [...answer.proposals, ...optionDrafts(answer.options)] : [];
  if (drafts.length && !solveFailed) {
    const checked = await withDeadline(checkDrafts(fresh, drafts, { authorEmail: author.email }), PROPOSALS_DEADLINE_MS, { proposals: [] as Proposal[], options: [] as PlanOption[] });
    proposals = checked.proposals;
    legacy = checked.options;
    // The reply was written before the drafts were checked: say which ideas
    // did not survive, so the words never name a card that is not there.
    const offered = new Set(proposals.map((p) => p.title.trim().toLowerCase()));
    const missed = [...new Set(drafts.map((d) => d.title.trim()).filter((t) => t && !offered.has(t.toLowerCase())))];
    if (missed.length) {
      replyText += proposals.length
        ? `\n\n(Not offered: ${missed.join(', ')} — ${missed.length === 1 ? 'it' : 'they'} would not fit the day or could not be found on the map.)`
        : `\n\nI couldn’t fit ${missed.length === 1 ? 'that' : 'any of those'} into the day as it stands, so there is nothing to choose yet — try another part of the day, or ask me to look further.`;
    }
  }
  if (editor && stillEmpty && !proposals.length && !changed) {
    // Still nothing to show: say so plainly, and offer what the pack has for the emptiest part of a day.
    const slot = latest ? openSlot(latest.plan, localDateIn(trip.timeZone, new Date())) : null;
    const offered = slot && pack.length ? await offerFromPack(fresh, slot, proposer).catch(() => ({ proposals: [] as Proposal[], options: [] as PlanOption[] })) : { proposals: [] as Proposal[], options: [] as PlanOption[] };
    proposals = offered.proposals;
    legacy = offered.options;
    replyText = proposals.length ? `${COULD_NOT} — here’s what I can do:` : `${COULD_NOT}, so nothing has been changed.`;
  }
  // v7: options for an open question, each checked against its day — for
  // someone who cannot edit (no proposals): at most 20 s, then the reply goes without.
  // Legacy cards go with every fill or swap group, whether or not the turn
  // also changed something: an older phone shows nothing else to tap.
  const options = editor
    ? legacy.slice(0, 3)
    : changed
      ? []
      : answer.options.length
        ? await Promise.race([checkOptions(trip, answer.options).catch(() => []), new Promise<[]>((r) => setTimeout(() => r([]), OPTIONS_DEADLINE_MS))])
        : [];

  // v8: question cards, checked by solving each answer (only those whose answers differ are kept).
  const questions = editor && answer.questions.length ? await checkQuestionDrafts(fresh, answer.questions, { authorEmail: author.email }).catch(() => [] as Question[]) : [];
  if (changed) {
    void Promise.resolve()
      .then(() => refreshQuestions(fresh, { reason: 'turn' }))
      .catch(() => {});
  }

  const rejectedNote = rejected.length ? `\n\n(Not done: ${rejected.map((r) => r.reason).join(' ')})` : '';
  const reply = await addMessage(trip.id, {
    role: 'assistant',
    text: replyText + rejectedNote,
    ops: applied,
    planVersion: changed ? planVersion : null,
    surface: input.surface,
    at: new Date(userAt.getTime() + 1),
    research: lookups,
    author,
  });
  const made = changed && !solveFailed && finalPlan && latest && planVersion !== latest.version;
  return {
    reply: reply.text,
    applied,
    rejected,
    quickReplies: answer.quickReplies,
    planVersion,
    changes,
    research: lookups,
    messages: [userMessage, reply],
    options,
    // v8
    proposals,
    questions,
    brief: await briefNow(fresh, planSurface).catch(() => (planSurface === 'phone' ? phoneBrief(brief) : brief)),
    diff: changed && finalPlan && !solveFailed ? planDiff(before, finalPlan, titles) : null,
    undo: made ? { toVersion: latest.version } : null,
  };
}

/** How long a turn waits for its proposals to be placed and checked. */
const PROPOSALS_DEADLINE_MS = 25_000;

const COULD_NOT = 'I couldn’t turn that into a change';

/** The empty-promise test on a whole answer (v7 options count as proposals). */
function promisesNothing(a: PlannerAnswer): boolean {
  return emptyPromise(a.reply, { ops: a.ops.length, proposals: a.proposals.length + a.options.length, questions: a.questions.length });
}

/** One plain call with the correction; null when it could not be made. */
async function correctiveRetry(ctx: PlannerContext, text: string, first: PlannerAnswer): Promise<PlannerAnswer | null> {
  try {
    const raw = await jsonCall(
      'trips-planner',
      [
        ...plannerMessages(ctx, text),
        { role: 'assistant', content: JSON.stringify({ reply: first.reply, ops: [], proposals: [], quickReplies: first.quickReplies }) },
        { role: 'user', content: EMPTY_PROMISE_CORRECTION },
      ],
      { maxTokens: 3000, timeoutMs: CHECK_CALL_MS },
    );
    return raw && typeof raw === 'object' ? readPlannerAnswer(raw) : null;
  } catch (err) {
    console.warn('[trips/converse] corrective retry unavailable:', (err as Error)?.message);
    return null;
  }
}

/**
 * What a background re-plan (research finished, routes arrived) says in the
 * conversation when it moved something — null when it moved nothing, so a
 * re-plan that only refreshed travel estimates stays quiet.
 */
export function backgroundNote(changes: string[]): string | null {
  const moved = changes.filter((c) => c !== 'No change to the schedule.' && c !== 'First plan.' && !c.startsWith('Travel times:'));
  return moved.length ? `The research finished and the plan moved: ${moved.join(' ')}` : null;
}

async function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([work.catch((err) => (console.warn('[trips/converse] proposals not checked:', (err as Error)?.message), fallback)), late]).finally(() => clearTimeout(timer));
}

/** Record where the planner's facts came from; never fails the turn. */
async function recordPlannerProvenance(tripId: string, rawOps: unknown[], result: ApplyResult, created: CreatedIds): Promise<void> {
  if (!result.applied.length) return;
  const patch = provenanceFor(pairApplied(rawOps, result, created), 'planner');
  if (!Object.keys(patch).length) return;
  await noteProvenance(tripId, patch).catch((err) => console.warn('[trips/converse] could not record where the facts came from:', (err as Error)?.message));
}

/** What a correction's re-solve newly dropped, in a sentence — '' when nothing. */
export function correctionNote(first: SolvedPlan, corrected: SolvedPlan, titles: Record<string, string>): string {
  const was = new Set(first.dropped.map((d) => d.wishId));
  const lost = corrected.dropped.filter((d) => !was.has(d.wishId));
  if (!lost.length) return '';
  return `\n\nAfter that change the plan could not fit ${lost.map((d) => `${titles[d.wishId] ?? 'a wish'} (${d.reason})`).join('; ')}.`;
}

/**
 * The check-and-correct pass: show the planner the request and how the days
 * actually changed; it confirms (maybe with a truer reply) or sends ONE round
 * of corrective ops. Null when the check could not run (the first reply stands).
 */
async function checkAndCorrect(
  trip: TripRecord,
  request: string,
  firstReply: string,
  first: ApplyResult,
  before: SolvedPlan | null,
  after: SolvedPlan,
  known: Set<string>,
  messageId: string,
  memoryOwner: string | null,
): Promise<{ reply: string | null; result: ApplyResult | null } | null> {
  const state = await loadState(trip.id);
  const titles = Object.fromEntries(state.wishes.map((w) => [w.id, w.title]));
  let check: ReturnType<typeof readCheck>;
  try {
    check = readCheck(
      await jsonCall(
        'trips-planner',
        [
          { role: 'system', content: CHECK_SYSTEM },
          { role: 'user', content: checkPrompt({ request, firstReply, applied: first.applied, diff: turnDiff(before, after, titles), titles }) },
        ],
        { maxTokens: 1500, timeoutMs: CHECK_CALL_MS },
      ),
    );
  } catch (err) {
    console.warn('[trips/converse] check unavailable, first reply stands:', (err as Error)?.message);
    return null;
  }
  if (!check.ops.length) return { reply: check.reply, result: null };
  const fresh = (await getTrip(trip.ownerEmail, trip.id)) ?? trip;
  const cap = captureCreated(effectsFor(fresh, messageId, memoryOwner));
  const result = await applyOps(
    check.ops,
    { trip: fresh, stays: state.stays, wishes: state.wishes, bookings: state.bookings, knownUrls: known, transport: await listTransport(trip.id), profile: fresh.profile },
    cap.fx,
  );
  await recordPlannerProvenance(trip.id, check.ops, result, cap.created);
  return { reply: check.reply, result };
}

/**
 * v8: apply ops outside a conversation turn — an accepted proposal, an
 * approved suggestion, a direct edit to the brief — through the same
 * validation and effects, noting the rows they create. A person made the
 * change, so with `provenance: 'you'` every fact it touched becomes theirs.
 * Never touches memory; does not re-solve (the caller does, once).
 */
export async function applyDirect(
  trip: TripRecord,
  ops: unknown[],
  opts: { trustedPlaces?: boolean; provenance?: 'you' | null } = {},
): Promise<{ result: ApplyResult; created: CreatedIds }> {
  const [state, transport] = await Promise.all([loadState(trip.id), listTransport(trip.id)]);
  const cap = captureCreated({ ...effectsFor(trip, null, null), trustsPlaces: opts.trustedPlaces === true });
  const result = await applyOps(
    ops,
    { trip, stays: state.stays, wishes: state.wishes, bookings: state.bookings, knownUrls: knownUrlsOf(state.wishes), transport, profile: trip.profile },
    cap.fx,
  );
  if (opts.provenance === 'you' && result.applied.length) {
    await noteProvenance(trip.id, provenanceFor(pairApplied(ops, result, cap.created), 'you')).catch((err) =>
      console.warn('[trips] could not record where the change came from:', (err as Error)?.message),
    );
  }
  return { result, created: cap.created };
}

/**
 * Apply ops outside a conversation turn — an approved suggestion (v5) — through
 * the same validation and effects, re-solve once, and log it as an `event`
 * message so the planner sees it. Never touches memory.
 */
export async function applyAndReplan(
  trip: TripRecord,
  ops: unknown[],
  opts: { surface: 'site' | 'phone'; eventText: string; trustedPlaces?: boolean },
): Promise<{ applied: ApplyResult['applied']; rejected: ApplyResult['rejected']; planVersion: number | null }> {
  const latest = await latestPlan(trip.id);
  // A parent approving a family member's suggestion: what they said, not a guess.
  const { result } = await applyDirect(trip, ops, { trustedPlaces: opts.trustedPlaces, provenance: 'you' });
  let planVersion = latest?.version ?? null;
  if (result.changed) {
    const fresh = (await getTrip(trip.ownerEmail, trip.id)) ?? trip;
    try {
      planVersion = (await replan(fresh, 'site')).plan.version;
    } catch (err) {
      console.error('[trips] re-plan after an approved suggestion failed:', err);
    }
  }
  const ids = result.research.flatMap((r) => r.wishIds);
  if (ids.length) {
    void startResearch(trip.ownerEmail, trip.id, { wishIds: ids, depth: 'brief' }).catch(() => {});
  }
  await logEdit(trip.id, opts.eventText, result.applied, result.changed ? planVersion : null, opts.surface);
  return { applied: result.applied, rejected: result.rejected, planVersion };
}

/**
 * A form edit, logged so the model sees it on its next turn. A plan change
 * (no `author`) is shown to the whole family; pass the asker as `author` for
 * an event that belongs to one person's thread (an ideas request).
 */
export async function logEdit(
  tripId: string,
  text: string,
  ops: TripMessage['ops'],
  planVersion: number | null,
  surface: 'site' | 'phone' = 'site',
  author: { email: string; id: string | null } | null = null,
): Promise<void> {
  await addMessage(tripId, { role: 'event', text, ops, planVersion, surface, author }).catch((err) =>
    console.warn('[trips] could not log the edit:', (err as Error)?.message),
  );
}
