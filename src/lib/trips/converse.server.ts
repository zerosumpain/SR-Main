// src/lib/trips/converse.server.ts
//
// One turn of the planning conversation (v2). The person says something; ONE
// call on the `trips-planner` workload reads the trip and answers with
// `{ reply, ops, quickReplies }`; the ops are validated and applied in order
// (./ops); the trip re-solves once; both messages are stored; the turn's
// `ConverseResult` goes back to the page or the phone.
//
// No model reachable is an ordinary state on a host without a key: the
// person's message is still stored, the reply says the planner is not
// available, and the forms keep working.

import { diffPlans } from './changes';
import { CHECK_SYSTEM, checkPrompt, readCheck, turnDiff } from './check';
import type { ConverseResult, LatLng, Observation, ResearchStep, SolvedPlan, TripMessage, TripOp } from './model';
import { agentTurn } from './agent.server';
import { gatherProfile, rememberStated, saveProfile } from './profile.server';
import { parseLooseJson } from './research';
import { jsonCall } from './llm.server';
import { applyOps, knownUrlsOf, readPlannerAnswer, urlsIn, type ApplyResult, type OpEffects } from './ops';
import { replan } from './plan.server';
import { plannerMessages, type PlannerContext } from './prompt';
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
  saveBooking,
  updateStay,
  updateTrip,
  updateWish,
  type TripRecord,
} from './store.server';

export const NO_PLANNER =
  'I can’t reach the planning model just now, so I couldn’t act on that. Your message is saved — try again shortly, or change the trip directly in the details.';

export interface ConverseInput {
  text: string;
  surface: 'site' | 'phone';
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
function effectsFor(trip: TripRecord, messageId: string | null = null): OpEffects {
  return {
    addTransport: (seg) => addTransport(trip.id, seg),
    updateTransport: (id, fields) => updateTransport(trip.id, id, fields),
    removeTransport: async (id) => void (await deleteTransport(trip.id, id)),
    remember: async (text, category) => {
      if (!messageId) throw new Error('remember needs the message it came from');
      return rememberStated({ text, category, messageId, ownerEmail: trip.ownerEmail });
    },
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
  const [state, latest, history, transport] = await Promise.all([loadState(trip.id), latestPlan(trip.id), recentMessages(trip.id, 30), listTransport(trip.id)]);
  // What the planner already knows (v3): gathered once, on the first turn.
  const profile = trip.profile ?? (await gatherProfile(trip).catch(() => null));
  const userAt = new Date();
  const userMessage = await addMessage(trip.id, { role: 'user', text, ops: [], planVersion: null, surface: input.surface, at: userAt });

  const ctx: PlannerContext = {
    trip,
    stays: state.stays,
    wishes: state.wishes,
    bookings: state.bookings,
    plan: latest?.plan ?? null,
    planVersion: latest?.version ?? null,
    messages: history,
    nowText: nowText(trip.timeZone),
    surface: input.surface,
    observation: input.observation ?? null,
    position: input.position ?? null,
    transport,
    profile,
  };

  // The agentic turn (v3): the planner may look things up first, within its budget.
  let answer: ReturnType<typeof readPlannerAnswer> | null = null;
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
    const reply = await addMessage(trip.id, { role: 'assistant', text: NO_PLANNER, ops: [], planVersion: null, surface: input.surface, at: new Date(userAt.getTime() + 1), research: lookups });
    return { reply: NO_PLANNER, applied: [], rejected: [], quickReplies: [], planVersion: latest?.version ?? null, changes: [], research: lookups, messages: [userMessage, reply] };
  }

  const known = knownUrlsOf(state.wishes, [
    ...(trip.guide?.taxi?.links ?? []).map((l) => l.url),
    ...urlsIn(text),
    ...history.filter((m) => m.role === 'user').flatMap((m) => urlsIn(m.text)),
    ...seenUrls,
  ]);
  const result = await applyOps(
    answer.ops,
    { trip, stays: state.stays, wishes: state.wishes, bookings: state.bookings, knownUrls: known, transport, profile },
    effectsFor(trip, userMessage.id),
  );
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
      const correction = await checkAndCorrect(trip, text, answer.reply, result, before, solved.plan, known, userMessage.id);
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

  // Research and suggestions run after the turn, in the background.
  const ids = [...new Set(research.flatMap((r) => r.wishIds))];
  if (ids.length) {
    void startResearch(trip.ownerEmail, trip.id, {
      wishIds: ids,
      depth: research.some((r) => r.depth === 'deep') ? 'deep' : 'brief',
      onDone: async (id) => {
        const t = await getTrip(trip.ownerEmail, id);
        if (t) await replan(t, 'site');
      },
    }).catch((err) => console.warn('[trips/converse] research did not start:', (err as Error)?.message));
  }
  for (const s of suggest.slice(0, 1)) {
    void (async () => {
      const near = s.near ? (await findPlace(/,/.test(s.near) ? s.near : `${s.near}, ${trip.destination}`, null))?.location ?? null : (input.position ?? null);
      await suggestNearby(trip.id, near);
    })().catch((err) => console.warn('[trips/converse] suggestions failed:', (err as Error)?.message));
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
  });
  return {
    reply: reply.text,
    applied,
    rejected,
    quickReplies: answer.quickReplies,
    planVersion,
    changes,
    research: lookups,
    messages: [userMessage, reply],
  };
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
        { maxTokens: 1500, timeoutMs: 90_000 },
      ),
    );
  } catch (err) {
    console.warn('[trips/converse] check unavailable, first reply stands:', (err as Error)?.message);
    return null;
  }
  if (!check.ops.length) return { reply: check.reply, result: null };
  const fresh = (await getTrip(trip.ownerEmail, trip.id)) ?? trip;
  const result = await applyOps(
    check.ops,
    { trip: fresh, stays: state.stays, wishes: state.wishes, bookings: state.bookings, knownUrls: known, transport: await listTransport(trip.id), profile: fresh.profile },
    effectsFor(fresh, messageId),
  );
  return { reply: check.reply, result };
}

/** A form edit, logged so the model sees it on its next turn. */
export async function logEdit(tripId: string, text: string, ops: TripMessage['ops'], planVersion: number | null, surface: 'site' | 'phone' = 'site'): Promise<void> {
  await addMessage(tripId, { role: 'event', text, ops, planVersion, surface }).catch((err) =>
    console.warn('[trips] could not log the edit:', (err as Error)?.message),
  );
}
