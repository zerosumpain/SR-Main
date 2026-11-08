// src/lib/trips/family.server.ts
//
// v5: trips open to the family, the I/O half. Who is calling on the phone
// lane (the owner, or a Family Circle member via `familyCaller`), what they
// may do with a trip, and the suggestion flow: a member suggests something
// for a slot, the parents are pushed, a parent approves (the wish goes in
// through the normal ops path → a new plan version) or rejects, the
// suggester is pushed, and the suggester may withdraw while it is pending.

import { json, type RequestEvent } from '@sveltejs/kit';
import { familyCaller } from '$lib/family/access.server';
import { familyPersonFor, familyRoster } from '$lib/family/roster.server';
import type { NativeIdentity } from '$lib/server/native-auth';
import type { NativeRole } from '$lib/server/native-handler';
import { getOwnerEmails, isOwnerEmail } from '$lib/server/access';
import { pushToEmails } from '$lib/server/push-devices';
import type { PushMessage } from '$lib/server/apns';
import { dayLabel } from './changes';
import { applyAndReplan, logEdit } from './converse.server';
import { suggestionWish, tripAccess } from './family';
import { DAY_STAGE_LABEL, type DayStage, type TripAccess, type WishDraft } from './model';
import { addSuggestion, decideSuggestion, getSuggestion, getTripById, type SuggestionRecord, type TripRecord } from './store.server';

export const NOT_FAMILY_TRIPS = 'Trips are for the family.';

export interface TripCaller {
  email: string;
  parent: boolean;
  isOwner: boolean;
  personId: string;
  name: string;
}

/** The family member calling the phone lane, or null (403) for anyone else. */
export async function nativeTripCaller(event: Pick<RequestEvent, 'locals'>, identity: NativeIdentity, role: NativeRole): Promise<TripCaller | null> {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return null;
  const person = await familyPersonFor(caller.email, caller.parent);
  return { email: caller.email, parent: caller.parent, isOwner: role === 'owner' && isOwnerEmail(caller.email), personId: person.id, name: person.name };
}

/** The caller and a trip they may open, or the Response to send instead. */
export async function familyTrip(
  event: Pick<RequestEvent, 'locals'>,
  identity: NativeIdentity,
  role: NativeRole,
  id: string,
): Promise<{ caller: TripCaller; trip: TripRecord; access: TripAccess } | Response> {
  const caller = await nativeTripCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY_TRIPS }, { status: 403 });
  const trip = await getTripById(id);
  if (!trip) return json({ error: 'No such trip.' }, { status: 404 });
  return { caller, trip, access: tripAccess(trip.ownerEmail, caller) };
}

/** Who created a trip, as the family knows them: roster id and name, never the email. */
export async function tripCreator(trip: Pick<TripRecord, 'ownerEmail'>): Promise<{ id: string; name: string }> {
  const p = await familyPersonFor(trip.ownerEmail, false);
  return { id: p.id, name: p.name };
}

// ── Pushes ─────────────────────────────────────────────────────────────────

const TRIP_CATEGORY = 'trip-suggestion';

function tripPush(text: { title: string; body: string }, trip: TripRecord, suggestionId: string, collapse: string): PushMessage {
  return {
    ...text,
    category: TRIP_CATEGORY,
    threadId: `trip-${trip.id}`,
    level: 'active',
    relevance: 0.5,
    collapseId: collapse.slice(0, 64),
    userInfo: { category: TRIP_CATEGORY, url: `sr://trips/${trip.id}`, tripId: trip.id, suggestionId },
  };
}

const slotName = (s: Pick<SuggestionRecord, 'date' | 'stage'>) => `${dayLabel(s.date)} ${DAY_STAGE_LABEL[s.stage as DayStage].toLowerCase()}`;

/** The parents to ask: the family's parents and the site owners, minus whoever suggested. */
async function parentEmails(except: string): Promise<string[]> {
  const roster = await familyRoster().catch(() => []);
  const parents = [...roster.filter((p) => p.parent).map((p) => p.email), ...getOwnerEmails()];
  return [...new Set(parents.map((e) => e.trim().toLowerCase()))].filter((e) => e && e !== except.trim().toLowerCase());
}

/** "Sam suggested gelato for Wed 28 Oct afternoon" to the parents. Fire-and-forget; never throws. */
export async function notifySuggested(trip: TripRecord, s: SuggestionRecord, opts: { push?: typeof pushToEmails } = {}): Promise<number> {
  try {
    const to = await parentEmails(s.byEmail);
    if (!to.length) return 0;
    const msg = tripPush({ title: trip.title, body: `${s.byName} suggested ${s.wish.title} for ${slotName(s)}` }, trip, s.id, `trip-sugg-${s.id}`);
    return (await (opts.push ?? pushToEmails)(to, msg)).sent;
  } catch (err) {
    console.warn('[trips] suggestion push failed', err);
    return 0;
  }
}

/** "Dad approved your gelato for Wed 28 Oct afternoon" to the suggester. Fire-and-forget; never throws. */
export async function notifyDecided(trip: TripRecord, s: SuggestionRecord, deciderName: string, opts: { push?: typeof pushToEmails } = {}): Promise<number> {
  try {
    if (s.status !== 'approved' && s.status !== 'rejected') return 0;
    const msg = tripPush({ title: trip.title, body: `${deciderName} ${s.status} your ${s.wish.title} for ${slotName(s)}` }, trip, s.id, `trip-sugg-${s.id}`);
    return (await (opts.push ?? pushToEmails)([s.byEmail], msg)).sent;
  } catch (err) {
    console.warn('[trips] decision push failed', err);
    return 0;
  }
}

// ── The flow ───────────────────────────────────────────────────────────────

export async function suggest(
  trip: TripRecord,
  caller: TripCaller,
  input: { date: string; stage: DayStage; wish: WishDraft; note: string | null; fitText: string | null },
): Promise<SuggestionRecord> {
  const s = await addSuggestion(trip.id, { byEmail: caller.email, byId: caller.personId, byName: caller.name, ...input });
  void notifySuggested(trip, s);
  return s;
}

export type Decision = 'approve' | 'reject' | 'withdraw';

/**
 * Decide a pending suggestion. approve/reject: a parent (canApprove);
 * withdraw: the suggester. Approving adds the wish through the normal ops
 * path (validated, re-solved, logged in the conversation).
 */
export async function decide(
  trip: TripRecord,
  caller: TripCaller,
  access: TripAccess,
  id: string,
  action: Decision,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const s = await getSuggestion(trip.id, id);
  if (!s) return { status: 404, body: { error: 'No such suggestion.' } };
  if (s.status !== 'pending') return { status: 409, body: { error: `That suggestion was already ${s.status}.` } };
  if (action === 'withdraw') {
    if (s.byEmail !== caller.email) return { status: 403, body: { error: 'Only whoever suggested it can withdraw it.' } };
    const done = await decideSuggestion(trip.id, id, 'withdrawn', { email: caller.email, id: caller.personId });
    return done ? { status: 200, body: { suggestionId: id, status: 'withdrawn' } } : { status: 409, body: { error: 'Someone got there first.' } };
  }
  if (!access.canApprove) return { status: 403, body: { error: 'A parent decides suggestions.' } };
  const done = await decideSuggestion(trip.id, id, action === 'approve' ? 'approved' : 'rejected', { email: caller.email, id: caller.personId });
  if (!done) return { status: 409, body: { error: 'Someone got there first.' } };
  if (action === 'reject') {
    // A plan-history event everyone sees (not the parent's chat): who turned down what.
    await logEdit(trip.id, `${caller.name} turned down ${done.byName}'s suggestion: ${done.wish.title} for ${slotName(done)}.`, [], null, 'phone');
  }
  let planVersion: number | null = null;
  let applied = 0;
  if (action === 'approve') {
    const r = await applyAndReplan(trip, [{ op: 'addWish', wish: suggestionWish(done) }], {
      surface: 'phone',
      eventText: `${caller.name} approved ${done.byName}'s suggestion: ${done.wish.title} for ${slotName(done)}.`,
      // The place it was suggested with (a meal option, a nearby idea) was found on the map: keep it.
      trustedPlaces: true,
    });
    planVersion = r.planVersion;
    applied = r.applied.length;
    if (!applied) {
      // The wish could not go in (e.g. already a wish): say so; the decision stands.
      void notifyDecided(trip, done, caller.name);
      return { status: 200, body: { suggestionId: id, status: 'approved', planVersion, warning: r.rejected.map((x) => x.reason).join(' ') || null } };
    }
  }
  void notifyDecided(trip, done, caller.name);
  return { status: 200, body: { suggestionId: id, status: done.status, planVersion } };
}
