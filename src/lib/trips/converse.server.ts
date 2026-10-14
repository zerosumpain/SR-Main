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

import type { ConverseResult, LatLng, Observation, TripMessage } from './model';
import { jsonCall } from './llm.server';
import { applyOps, knownUrlsOf, readPlannerAnswer, urlsIn, type OpEffects } from './ops';
import { replan } from './plan.server';
import { plannerMessages, type PlannerContext } from './prompt';
import { findPlace, startResearch, suggestNearby } from './research.server';
import {
  addMessage,
  addStay,
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

/** The effects the ops may have, bound to one trip. */
function effectsFor(trip: TripRecord): OpEffects {
  return {
    resolvePlace: async (query, near) => {
      const q = /,/.test(query) || !trip.destination ? query : `${query}, ${trip.destination}`;
      const p = await findPlace(q, near);
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
  const [state, latest, history] = await Promise.all([loadState(trip.id), latestPlan(trip.id), recentMessages(trip.id, 30)]);
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
  };

  let answer: ReturnType<typeof readPlannerAnswer> | null = null;
  try {
    answer = readPlannerAnswer(await jsonCall('trips-planner', plannerMessages(ctx, text), { maxTokens: 2500, timeoutMs: 120_000 }));
  } catch (err) {
    console.warn('[trips/converse] planner unavailable:', (err as Error)?.message);
  }

  if (!answer) {
    const reply = await addMessage(trip.id, { role: 'assistant', text: NO_PLANNER, ops: [], planVersion: null, surface: input.surface, at: new Date(userAt.getTime() + 1) });
    return { reply: NO_PLANNER, applied: [], rejected: [], quickReplies: [], planVersion: latest?.version ?? null, changes: [], messages: [userMessage, reply] };
  }

  const known = knownUrlsOf(state.wishes, [
    ...(trip.guide?.taxi?.links ?? []).map((l) => l.url),
    ...urlsIn(text),
    ...history.filter((m) => m.role === 'user').flatMap((m) => urlsIn(m.text)),
  ]);
  const result = await applyOps(answer.ops, { trip, stays: state.stays, wishes: state.wishes, bookings: state.bookings, knownUrls: known }, effectsFor(trip));

  let planVersion = latest?.version ?? null;
  let changes: string[] = [];
  if (result.changed) {
    const fresh = (await getTrip(trip.ownerEmail, trip.id)) ?? trip;
    try {
      // A change asked for on the phone is the phone's own version of today:
      // it is not held back by the running-day rule.
      const solved = await replan(fresh, input.surface === 'phone' ? 'phone' : 'site', { keepRunningDay: input.surface !== 'phone' });
      planVersion = solved.plan.version;
      if (solved.created) changes = solved.plan.changes;
    } catch (err) {
      console.error('[trips/converse] re-plan failed:', err);
      changes = ['The changes are saved, but the plan could not be rebuilt just now.'];
    }
  }

  // Research and suggestions run after the turn, in the background.
  const ids = [...new Set(result.research.flatMap((r) => r.wishIds))];
  if (ids.length) {
    void startResearch(trip.ownerEmail, trip.id, {
      wishIds: ids,
      depth: result.research.some((r) => r.depth === 'deep') ? 'deep' : 'brief',
      onDone: async (id) => {
        const t = await getTrip(trip.ownerEmail, id);
        if (t) await replan(t, 'site');
      },
    }).catch((err) => console.warn('[trips/converse] research did not start:', (err as Error)?.message));
  }
  for (const s of result.suggest.slice(0, 1)) {
    void (async () => {
      const near = s.near ? (await findPlace(/,/.test(s.near) ? s.near : `${s.near}, ${trip.destination}`, null))?.location ?? null : (input.position ?? null);
      await suggestNearby(trip.id, near);
    })().catch((err) => console.warn('[trips/converse] suggestions failed:', (err as Error)?.message));
  }

  const rejectedNote = result.rejected.length ? `\n\n(Not done: ${result.rejected.map((r) => r.reason).join(' ')})` : '';
  const reply = await addMessage(trip.id, {
    role: 'assistant',
    text: answer.reply + rejectedNote,
    ops: result.applied,
    planVersion: result.changed ? planVersion : null,
    surface: input.surface,
    at: new Date(userAt.getTime() + 1),
  });
  return {
    reply: reply.text,
    applied: result.applied,
    rejected: result.rejected,
    quickReplies: answer.quickReplies,
    planVersion,
    changes,
    messages: [userMessage, reply],
  };
}

/** A form edit, logged so the model sees it on its next turn. */
export async function logEdit(tripId: string, text: string, ops: TripMessage['ops'], planVersion: number | null, surface: 'site' | 'phone' = 'site'): Promise<void> {
  await addMessage(tripId, { role: 'event', text, ops, planVersion, surface }).catch((err) =>
    console.warn('[trips] could not log the edit:', (err as Error)?.message),
  );
}
