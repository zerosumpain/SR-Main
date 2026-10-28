// src/lib/trips/chat-tools.ts
//
// jkai's trip tools (overhaul plan 2026-10-28, P2-3 and P2-4, slice 7a). There
// is one planner brain and jkai is its front door: reads come straight off the
// store, and every change goes THROUGH the planner (`converse`, `undoTo`) —
// jkai never calls the store's write functions (addStay, updateWish,
// saveBooking …), and PLANNER_TOOLS and the planner's own loop stay private.
//
//   trip_list, trip_get, trip_thread, trip_open_items   read
//   trip_ask       mutate, no card: runs the planner model in its advice-only
//                  mode (no ops, proposals or questions) and writes the
//                  exchange to John's own trip thread, labelled 'jkai'.
//   trip_converse  mutate, confirm always: the planner as an editor. converse()
//                  APPLIES its ops at once (decision 9: apply with a card and
//                  undo, not proposals-only); the result carries undo.toVersion.
//   trip_undo      mutate, light confirm: back to a version (a new version led
//                  by "Undone: …", so an undo can itself be undone).
//
// Owner-only, not member-safe (none is on MEMBER_SAFE_TOOLS; trips are the
// first member candidate once member reach is decided), not on WhatsApp's or the
// heartbeat's lists, and an unattended principal never reaches the changes.
// Idempotency is NOT claimed: ToolExecContext has no requestId yet, so a
// retried trip_ask asks twice.
//
// MERGE ON 31 OCTOBER OR LATER — John is on a live trip until 30 October.
//
// Registered from here (src/hooks.server.ts imports this module at boot), not
// imported by $lib/tools/registry.

import { register, type ToolExecContext } from '$lib/tools/registry-internal';
import { refuseUnlessOwner } from '$lib/tools/tools/owner-only';
import { getOwnerEmails } from '$lib/server/access';
import { getTripById, latestPlan, listAllTrips, listTransport, loadState, recentMessages, tripOnly, viewerOf, type TripRecord } from './store.server';
import { listProposals, listQuestions } from './decisions.store.server';
import { localDateIn } from './routing';
import { bookingView, dayView, messageView, pickDay, planView, stayView, transportView, tripDeepLink, tripHref } from './chat-view';

const PARTS = ['summary', 'plan', 'brief', 'bookings', 'transport'] as const;
type Part = (typeof PARTS)[number];

function owner(): string | null {
  return getOwnerEmails()[0]?.trim().toLowerCase() || null;
}

/** The trip named by `tripId`, or the refusal to send back. */
async function tripFor(name: string, args: Record<string, unknown>, ctx?: ToolExecContext): Promise<{ trip: TripRecord; email: string } | { success: false; error: string }> {
  const refused = refuseUnlessOwner(name, ctx);
  if (refused) return refused as { success: false; error: string };
  const email = owner();
  if (!email) return { success: false, error: 'No site owner is configured, so trips cannot be read.' };
  const id = typeof args.tripId === 'string' ? args.tripId.trim() : '';
  if (!id) return { success: false, error: 'tripId is required (trip_list gives the ids).' };
  const trip = await getTripById(id);
  if (!trip) return { success: false, error: `No trip ${id}.` };
  return { trip, email };
}

const links = (id: string) => ({ url: tripHref(id), deepLink: tripDeepLink(id) });
const tripIdParam = { tripId: { type: 'string', description: 'The trip id, from trip_list.' } };

register({
  name: 'trip_list',
  description: "John's trips, newest first: title, destination, dates, status and plan version, each with its page link. Read-only.",
  parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 30, description: 'Most trips to list. Default 10.' } }, required: [] },
  category: 'Trips',
  toolset: 'trips',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('trip_list', ctx);
    if (refused) return refused;
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.min(30, Math.trunc(args.limit))) : 10;
    const trips = (await listAllTrips()).slice(0, limit);
    return {
      success: true,
      data: {
        trips: trips.map((t) => ({ id: t.id, title: t.title, destination: t.destination, startDate: t.startDate, endDate: t.endDate, status: t.status, planVersion: t.planVersion, ...links(t.id) })),
        message: trips.length ? 'Read one with trip_get.' : 'No trips yet.',
      },
    };
  },
});

register({
  name: 'trip_get',
  description:
    "One trip, compact. part: summary (dates, stays, plan version, open decisions), plan (every day's stops with times), brief (what the planner knows and where each fact came from), bookings, or transport. Pass day (a day number like 2, a date, 'today' or 'tomorrow') for that one day's plan — \"what's on day 2\". Read-only; to change anything use trip_converse.",
  parameters: {
    type: 'object',
    properties: {
      ...tripIdParam,
      part: { type: 'string', enum: [...PARTS], description: 'Which part. Default summary (or plan when day is given).' },
      day: { type: ['string', 'number'], description: 'Optional: a 1-based day number, a YYYY-MM-DD date, "today" or "tomorrow".' },
    },
    required: ['tripId'],
  },
  category: 'Trips',
  toolset: 'trips',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const found = await tripFor('trip_get', args, ctx);
    if ('success' in found) return found;
    const { trip } = found;
    const part: Part = (PARTS as readonly string[]).includes(String(args.part)) ? (args.part as Part) : args.day !== undefined ? 'plan' : 'summary';
    const head = { id: trip.id, title: trip.title, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate, timeZone: trip.timeZone, status: trip.status, ...links(trip.id) };
    if (part === 'plan') {
      const latest = await latestPlan(trip.id);
      if (!latest) return { success: true, data: { ...head, planVersion: null, message: 'There is no plan yet.' } };
      if (args.day !== undefined) {
        const i = pickDay(latest.plan, args.day, localDateIn(trip.timeZone, new Date()));
        if (i === null || i < 0) {
          return { success: false, error: `That day is not in the plan: it has ${latest.plan.days.length} day(s), ${latest.plan.days[0]?.date ?? '?'} to ${latest.plan.days.at(-1)?.date ?? '?'}.` };
        }
        return { success: true, data: { ...head, planVersion: latest.version, day: dayView(latest.plan.days[i], i) } };
      }
      return { success: true, data: { ...head, planVersion: latest.version, ...planView(latest.plan) } };
    }
    if (part === 'bookings') {
      const state = await loadState(trip.id);
      return { success: true, data: { ...head, bookings: state.bookings.map(bookingView) } };
    }
    if (part === 'transport') {
      return { success: true, data: { ...head, transport: (await listTransport(trip.id)).map(transportView) } };
    }
    if (part === 'brief') {
      const { briefNow } = await import('./brief.server');
      const brief = await briefNow(trip, 'site');
      const text = JSON.stringify(brief);
      return { success: true, data: { ...head, brief: text.length > 8000 ? { truncated: true, json: `${text.slice(0, 8000)}…` } : brief } };
    }
    const [state, latest, proposals, questions] = await Promise.all([
      loadState(trip.id),
      latestPlan(trip.id),
      listProposals(trip.id, { status: ['open'] }).catch(() => []),
      listQuestions(trip.id, { status: ['open'] }).catch(() => []),
    ]);
    return {
      success: true,
      data: {
        ...head,
        notes: tripOnly(trip).notes,
        stays: state.stays.map(stayView),
        wishes: state.wishes.filter((w) => !w.suggested && !w.skipped).length,
        bookings: state.bookings.filter((b) => b.status !== 'cancelled').length,
        planVersion: latest?.version ?? null,
        days: latest?.plan.days.map((d, i) => ({ day: i + 1, date: d.date, stops: d.stops.filter((s) => s.kind === 'wish').length })) ?? [],
        open: { proposals: proposals.length, questions: questions.length },
      },
    };
  },
});

register({
  name: 'trip_thread',
  description: "John's own conversation with the trip planner for one trip (his messages, the planner's replies and the plan changes everyone sees), oldest first. Read-only.",
  parameters: { type: 'object', properties: { ...tripIdParam, limit: { type: 'number', minimum: 1, maximum: 20, description: 'Most recent messages. Default 10.' } }, required: ['tripId'] },
  category: 'Trips',
  toolset: 'trips',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const found = await tripFor('trip_thread', args, ctx);
    if ('success' in found) return found;
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.min(20, Math.trunc(args.limit))) : 10;
    const messages = await recentMessages(found.trip.id, viewerOf(found.trip, found.email), limit);
    return { success: true, data: { id: found.trip.id, title: found.trip.title, messages: messages.map(messageView), ...links(found.trip.id) } };
  },
});

register({
  name: 'trip_open_items',
  description: 'What is waiting on a trip: open proposals and open questions from the planner, as titles with the trip page link. Decisions are made on the trip page or the phone card, never from chat. Read-only.',
  parameters: { type: 'object', properties: { ...tripIdParam }, required: ['tripId'] },
  category: 'Trips',
  toolset: 'trips',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const found = await tripFor('trip_open_items', args, ctx);
    if ('success' in found) return found;
    const [proposals, questions] = await Promise.all([listProposals(found.trip.id, { status: ['open'] }), listQuestions(found.trip.id, { status: ['open'] })]);
    return {
      success: true,
      data: {
        id: found.trip.id,
        title: found.trip.title,
        proposals: proposals.map((p) => ({ title: p.title, why: p.why, kind: p.kind })),
        questions: questions.map((q) => ({ prompt: q.prompt, why: q.why })),
        decideAt: tripHref(found.trip.id),
        ...links(found.trip.id),
      },
    };
  },
});

/** The planner's turn, as the result jkai reads. */
function turnResult(trip: TripRecord, turn: Awaited<ReturnType<typeof import('./converse.server').converse>>) {
  return {
    id: trip.id,
    title: trip.title,
    reply: turn.reply,
    applied: turn.applied.length,
    changes: turn.changes,
    planVersion: turn.planVersion,
    proposals: (turn.proposals ?? []).map((p) => ({ title: p.title, why: p.why })),
    questions: (turn.questions ?? []).map((q) => ({ prompt: q.prompt })),
    undo: turn.undo ?? null,
    label: "The trip planner's reply (its own words), from its conversation on this trip",
    ...links(trip.id),
  };
}

const TEXT_MAX = 2000;

register({
  name: 'trip_ask',
  // Runs the planner model and writes John's trip thread, so not a read; no
  // card, because it changes no plan (advice-only mode).
  effect: 'mutate',
  confirm: 'never',
  description:
    "Ask the trip planner a question about a trip — what it knows, what would fit, what it suggests. The planner answers in advice-only mode: it changes nothing. The exchange is added to John's own conversation on that trip. For a change to the plan use trip_converse.",
  parameters: { type: 'object', properties: { ...tripIdParam, question: { type: 'string', description: "The question, in John's words." } }, required: ['tripId', 'question'] },
  category: 'Trips',
  toolset: 'trips',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const found = await tripFor('trip_ask', args, ctx);
    if ('success' in found) return found;
    const question = typeof args.question === 'string' ? args.question.trim().slice(0, TEXT_MAX) : '';
    if (!question) return { success: false, error: 'question is required' };
    ctx?.emit?.('Asking the trip planner…');
    const { converse } = await import('./converse.server');
    const turn = await converse(found.trip, { text: question, surface: 'jkai', caller: { isOwner: true, canEdit: false, name: null, email: found.email } });
    return { success: true, data: turnResult(found.trip, turn) };
  },
});

register({
  name: 'trip_converse',
  effect: 'mutate',
  confirm: 'always',
  description:
    "Ask the trip planner to CHANGE a trip (move a stop, add a dinner, make a day lighter). The planner applies its changes to the plan at once and re-plans; it may also offer proposals, which John decides on the trip page. John confirms before it runs. The result says what changed and carries undo.toVersion — offer trip_undo if he does not like it. Never edit a trip any other way.",
  parameters: { type: 'object', properties: { ...tripIdParam, request: { type: 'string', description: "The change, in John's words." } }, required: ['tripId', 'request'] },
  category: 'Trips',
  toolset: 'trips',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const found = await tripFor('trip_converse', args, ctx);
    if ('success' in found) return found;
    const request = typeof args.request === 'string' ? args.request.trim().slice(0, TEXT_MAX) : '';
    if (!request) return { success: false, error: 'request is required' };
    ctx?.emit?.('The trip planner is working on it…');
    const { converse } = await import('./converse.server');
    const turn = await converse(found.trip, { text: request, surface: 'jkai', caller: { isOwner: true, canEdit: true, name: null, email: found.email } });
    return { success: true, data: turnResult(found.trip, turn) };
  },
});

register({
  name: 'trip_undo',
  effect: 'mutate',
  description:
    'Put a trip back as it was at an earlier plan version (default: the version before the latest) — the undo for trip_converse. It makes a NEW version led by "Undone: …", so it can itself be undone. John confirms first.',
  parameters: { type: 'object', properties: { ...tripIdParam, toVersion: { type: 'number', description: 'The version to go back to (undo.toVersion from trip_converse). Omit for the one before the latest.' } }, required: ['tripId'] },
  category: 'Trips',
  toolset: 'trips',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const found = await tripFor('trip_undo', args, ctx);
    if ('success' in found) return found;
    const raw = args.toVersion;
    if (raw !== undefined && raw !== null && !Number.isInteger(raw)) return { success: false, error: 'toVersion is a version number.' };
    const { undoTo } = await import('./undo.server');
    const out = await undoTo(found.trip, (raw as number | null | undefined) ?? null, { name: 'jkai', surface: 'site' });
    if (out.status !== 200) return { success: false, error: String(out.body.error ?? 'Could not undo.') };
    return { success: true, data: { id: found.trip.id, title: found.trip.title, ...out.body, ...links(found.trip.id) } };
  },
});
