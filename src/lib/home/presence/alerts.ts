// src/lib/home/presence/alerts.ts
//
// Arrivals and departures, from the trail to the people who follow them
// (household movement, spec section 6).
//
//  1. `runCrossings` reads each person's new trail rows since the last run
//     (whatever wrote them: the push stream, the poll, the app), walks them
//     through `stepCrossings`, and writes a `household_event` row per crossing,
//     deduped on (subject, place, kind) within ten minutes.
//  2. `deliverAlerts` forwards undelivered events to the companion pilot's
//     per-user alert queue (the app shows them) and, for places the owner has
//     flagged for WhatsApp, sends one to each follower who asked for it.
//
// Never `notifyOwner`: that channel is the owner's alone. Delivery failures
// are reported, never thrown, and retried on the next run while the crossing
// is under two hours old. Older than that and it is left: "arrived at school"
// three hours late is noise, not news.
//
// A WhatsApp number is never logged. Summaries carry the last three digits.

import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail, householdEvent } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { followers, type HouseholdMember } from './members';
import { getHomePlace } from './places';
import {
  DEDUPE_WINDOW_MS,
  eventId,
  isDuplicate,
  stepCrossings,
  type CrossingKind,
  type CrossingPlace,
  type EventKey,
  type InsideState,
  type TrailFix,
} from './crossings';
import { COMPANION_DEFAULT_URL } from './companion';
import { LOCAL_TZ, errMsg } from './types';

export const INSIDE_KEY_PREFIX = 'home.presence.inside.';
/** An undelivered crossing older than this is left undelivered. */
export const DELIVERY_WINDOW_MS = 2 * 60 * 60_000;
/** At most one WhatsApp per (recipient, mover, place) inside this window. */
export const WHATSAPP_FLOOR_MS = 30 * 60_000;
/** New trail rows read per person per run; the rest wait for the next run. */
const FIXES_PER_RUN = 500;
const PILOT_BATCH = 200;
const PILOT_TIMEOUT_MS = 15_000;

export interface AlertPlace extends CrossingPlace {
  label: string | null;
  whatsappAlerts: boolean;
  isHome: boolean;
}

export interface AlertEvent {
  id: string;
  subject: string;
  placeId: string;
  kind: CrossingKind;
  at: Date;
  forwardedAt: Date | null;
  whatsappSent: string[];
}

// ── Pure pieces ──────────────────────────────────────────────────────────────

export function insideKey(subject: string): string {
  return `${INSIDE_KEY_PREFIX}${subject}`;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** What a place is called in an alert. Home is "home" until it is named. */
export function placeName(place: Pick<AlertPlace, 'label' | 'isHome'> | undefined): string {
  if (place?.label) return place.label;
  return place?.isHome ? 'home' : 'a place';
}

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: LOCAL_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** HH:MM on the household's clock (the server runs UTC). */
export function localClock(at: Date): string {
  return CLOCK.format(at);
}

/**
 * The alert's words. It carries the crossing time, never "just now": a phone
 * drains its queue when it wakes, which can be a while after the fact.
 */
export function alertText(
  who: string,
  kind: CrossingKind,
  place: string,
  at: Date,
): { title: string; body: string } {
  const title = kind === 'arrive' ? `${who} arrived at ${place}` : `${who} left ${place}`;
  return { title: title.slice(0, 120), body: `at ${localClock(at)}`.slice(0, 300) };
}

export function displayNameOf(members: readonly HouseholdMember[], subject: string): string {
  return members.find((m) => m.subject === subject)?.displayName || capitalise(subject);
}

/**
 * Who gets the in-app alert for `subject` moving: followers who are on the
 * app (source 'companion') and so have an email the pilot knows. Never the
 * mover. PURE.
 */
export function pilotRecipients(members: readonly HouseholdMember[], subject: string): string[] {
  return followers(members, subject)
    .filter((m) => m.source === 'companion' && !!m.email)
    .map((m) => m.email as string);
}

/** Followers who asked for WhatsApp and have a number. Never the mover. PURE. */
export function whatsappFollowers(members: readonly HouseholdMember[], subject: string): HouseholdMember[] {
  return followers(members, subject).filter((m) => m.alerts?.whatsapp === true && !!m.whatsapp?.trim());
}

/** Whether an event is still owed to the pilot. PURE. */
export function isDeliverable(ev: Pick<AlertEvent, 'at' | 'forwardedAt'>, now: Date): boolean {
  return ev.forwardedAt == null && now.getTime() - ev.at.getTime() <= DELIVERY_WINDOW_MS;
}

/** A number as a summary may show it: the last three digits. PURE. */
export function maskNumber(n: string): string {
  const digits = n.replace(/\D/g, '');
  return `…${digits.slice(-3)}`;
}

export interface PlannedSend {
  eventId: string;
  recipient: string;
  number: string;
  text: string;
}

/**
 * The WhatsApp messages owed, given recent events. PURE.
 *
 * Only for places flagged `whatsappAlerts`, only to followers who asked, and
 * only for events still inside the delivery window. The rate floor: no send to
 * a recipient about (mover, place) within 30 minutes of another event about the
 * same pair that already reached them, either side. It is measured between
 * crossing times, not against the clock, so a retry on a later run reaches the
 * same verdict. Planned sends count at once, so two crossings in one run are
 * one message.
 *
 * `events` should include up to half an hour before the delivery window, so
 * the floor can see what was sent just before it.
 */
export function planWhatsApp(
  events: readonly AlertEvent[],
  places: ReadonlyMap<string, AlertPlace>,
  members: readonly HouseholdMember[],
  now: Date,
): PlannedSend[] {
  const sent = new Map(events.map((e) => [e.id, new Set(e.whatsappSent)]));
  const ordered = [...events].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
  const out: PlannedSend[] = [];
  for (const ev of ordered) {
    if (now.getTime() - ev.at.getTime() > DELIVERY_WINDOW_MS) continue;
    const place = places.get(ev.placeId);
    if (!place?.whatsappAlerts) continue;
    const who = displayNameOf(members, ev.subject);
    const { title, body } = alertText(who, ev.kind, placeName(place), ev.at);
    for (const r of whatsappFollowers(members, ev.subject)) {
      if (sent.get(ev.id)?.has(r.subject)) continue;
      const floored = ordered.some(
        (o) =>
          o.id !== ev.id &&
          o.subject === ev.subject &&
          o.placeId === ev.placeId &&
          Math.abs(o.at.getTime() - ev.at.getTime()) < WHATSAPP_FLOOR_MS &&
          sent.get(o.id)?.has(r.subject),
      );
      if (floored) continue;
      out.push({ eventId: ev.id, recipient: r.subject, number: (r.whatsapp as string).trim(), text: `${title} ${body}` });
      sent.get(ev.id)?.add(r.subject);
    }
  }
  return out;
}

export interface PilotEvent {
  id: string;
  recipients: string[];
  title: string;
  body: string;
  at: string;
}

/** The pilot's payload for events owed to it. Events nobody on the app
 *  follows are returned apart: there is nothing to send, only to mark. PURE. */
export function buildPilotEvents(
  events: readonly AlertEvent[],
  places: ReadonlyMap<string, AlertPlace>,
  members: readonly HouseholdMember[],
): { send: PilotEvent[]; nobody: string[] } {
  const send: PilotEvent[] = [];
  const nobody: string[] = [];
  for (const ev of events) {
    const recipients = pilotRecipients(members, ev.subject);
    if (!recipients.length) {
      nobody.push(ev.id);
      continue;
    }
    const { title, body } = alertText(displayNameOf(members, ev.subject), ev.kind, placeName(places.get(ev.placeId)), ev.at);
    send.push({ id: ev.id.slice(0, 100), recipients, title, body, at: ev.at.toISOString() });
  }
  return { send, nobody };
}

// ── The pilot ────────────────────────────────────────────────────────────────

function pilotToken(): string | null {
  const t = process.env.COMPANION_HOUSEHOLD_TOKEN?.trim();
  return t ? t : null;
}

function pilotUrl(): string {
  return (process.env.COMPANION_URL || COMPANION_DEFAULT_URL).replace(/\/+$/, '');
}

/**
 * POST events to the pilot's alert queue, in batches of 200. Returns the ids
 * the pilot accepted (every id of every batch answered 2xx). Stops at the
 * first failed batch and reports it; what was accepted before stays accepted.
 * Null without a token: no request is made.
 */
export async function postToPilot(
  events: readonly PilotEvent[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ accepted: string[]; error?: string } | null> {
  const token = pilotToken();
  if (!token) return null;
  const accepted: string[] = [];
  for (let i = 0; i < events.length; i += PILOT_BATCH) {
    const batch = events.slice(i, i + PILOT_BATCH);
    try {
      const res = await fetchImpl(`${pilotUrl()}/api/apple/household/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(PILOT_TIMEOUT_MS),
      });
      if (!res.ok) return { accepted, error: `alert queue answered ${res.status}` };
    } catch (err) {
      return { accepted, error: errMsg(err) };
    }
    accepted.push(...batch.map((e) => e.id));
  }
  return { accepted };
}

// ── Detection ────────────────────────────────────────────────────────────────

/** The places crossings are watched at: every active place flagged for
 *  alerts, and home whatever its flag says. */
export async function loadAlertPlaces(): Promise<AlertPlace[]> {
  const rows = await db
    .select({
      id: daydreamPlaces.id,
      lat: daydreamPlaces.lat,
      lon: daydreamPlaces.lon,
      radiusM: daydreamPlaces.radiusM,
      label: daydreamPlaces.label,
      whatsappAlerts: daydreamPlaces.whatsappAlerts,
    })
    .from(daydreamPlaces)
    .where(and(eq(daydreamPlaces.status, 'active'), eq(daydreamPlaces.alerts, true)));
  const home = await getHomePlace();
  const out: AlertPlace[] = rows.map((r) => ({ ...r, isHome: r.id === home?.id }));
  if (home && !out.some((p) => p.id === home.id)) {
    const [flags] = await db
      .select({ whatsappAlerts: daydreamPlaces.whatsappAlerts })
      .from(daydreamPlaces)
      .where(eq(daydreamPlaces.id, home.id))
      .limit(1);
    out.push({ ...home, whatsappAlerts: flags?.whatsappAlerts ?? false, isHome: true });
  }
  return out;
}

async function newFixes(subject: string, state: InsideState | null): Promise<TrailFix[]> {
  const cols = {
    id: daydreamTrail.id,
    lat: daydreamTrail.lat,
    lon: daydreamTrail.lon,
    accuracyM: daydreamTrail.accuracyM,
    ts: daydreamTrail.ts,
  };
  const positioned = and(eq(daydreamTrail.subject, subject), isNotNull(daydreamTrail.lat), ne(daydreamTrail.source, 'gap'));
  const rows = state
    ? await db
        .select(cols)
        .from(daydreamTrail)
        .where(and(positioned, sql`${daydreamTrail.id} > ${state.lastId}`))
        .orderBy(asc(daydreamTrail.id))
        .limit(FIXES_PER_RUN)
    : // First run: only the newest fix matters, to know where they are now.
      await db.select(cols).from(daydreamTrail).where(positioned).orderBy(desc(daydreamTrail.id)).limit(1);
  return rows.map((r) => ({ id: r.id, lat: r.lat as number, lon: r.lon as number, accuracyM: r.accuracyM, ts: r.ts }));
}

export interface CrossingsResult {
  /** Events written. */
  written: number;
  /** Crossings dropped as a repeat within ten minutes. */
  deduped: number;
  /** People seen for the first time: state set, nothing raised. */
  initialised: string[];
  errors: string[];
}

/**
 * Walk every member's new fixes and write the crossings they make. A failure
 * for one person is recorded and the rest carry on; their state is left where
 * it was, so the same fixes are read again next run.
 */
export async function runCrossings(members: readonly HouseholdMember[]): Promise<CrossingsResult> {
  const result: CrossingsResult = { written: 0, deduped: 0, initialised: [], errors: [] };
  const places = await loadAlertPlaces();
  for (const m of members) {
    try {
      const state = await getSetting<InsideState>(insideKey(m.subject));
      const fixes = await newFixes(m.subject, state);
      if (!fixes.length) continue;
      const step = stepCrossings(state, fixes, places);
      if (!state) result.initialised.push(m.subject);

      if (step.events.length) {
        const times = step.events.map((e) => e.at.getTime());
        const existing: EventKey[] = await db
          .select({ subject: householdEvent.subject, placeId: householdEvent.placeId, kind: householdEvent.kind, at: householdEvent.at })
          .from(householdEvent)
          .where(
            and(
              eq(householdEvent.subject, m.subject),
              gte(householdEvent.at, new Date(Math.min(...times) - DEDUPE_WINDOW_MS)),
              lte(householdEvent.at, new Date(Math.max(...times) + DEDUPE_WINDOW_MS)),
            ),
          );
        const rows = [];
        for (const e of step.events) {
          const key: EventKey = { subject: m.subject, placeId: e.placeId, kind: e.kind, at: e.at };
          if (isDuplicate(existing, key)) {
            result.deduped++;
            continue;
          }
          existing.push(key);
          rows.push({ id: eventId(m.subject, e.placeId, e.kind, e.at), ...key });
        }
        if (rows.length) {
          const inserted = await db
            .insert(householdEvent)
            .values(rows)
            .onConflictDoNothing()
            .returning({ id: householdEvent.id });
          result.written += inserted.length;
        }
      }
      if (step.state) await setSetting(insideKey(m.subject), step.state);
    } catch (err) {
      result.errors.push(`${m.subject}: ${errMsg(err).slice(0, 120)}`);
    }
  }
  return result;
}

// ── Delivery ─────────────────────────────────────────────────────────────────

export interface DeliveryResult {
  forwarded: number;
  /** Events nobody on the app follows, marked done with nothing sent. */
  unfollowed: number;
  pilotError?: string;
  /** Masked: the last three digits only. */
  whatsappSent: string[];
  whatsappFailed: string[];
}

export type WhatsAppSend = (to: string, text: string) => Promise<{ sent: boolean; error?: string }>;

/** The site's WhatsApp service, the way followup-queue reaches it. */
async function defaultWhatsApp(to: string, text: string) {
  const { getWhatsAppService } = await import('$lib/workflows/whatsapp/service');
  return getWhatsAppService().sendMessage(to, text);
}

/**
 * Hand recent crossings to the people who follow them. Never throws on a
 * delivery failure: the event stays owed and the next run tries again while it
 * is under two hours old.
 */
export async function deliverAlerts(
  members: readonly HouseholdMember[],
  deps: { fetchImpl?: typeof fetch; sendWhatsApp?: WhatsAppSend; now?: Date } = {},
): Promise<DeliveryResult> {
  const now = deps.now ?? new Date();
  const sendWhatsApp = deps.sendWhatsApp ?? defaultWhatsApp;
  const result: DeliveryResult = { forwarded: 0, unfollowed: 0, whatsappSent: [], whatsappFailed: [] };

  const since = new Date(now.getTime() - DELIVERY_WINDOW_MS - WHATSAPP_FLOOR_MS);
  const rows = await db
    .select()
    .from(householdEvent)
    .where(gte(householdEvent.at, since))
    .orderBy(asc(householdEvent.at));
  if (!rows.length) return result;
  const events: AlertEvent[] = rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    placeId: r.placeId,
    kind: r.kind === 'leave' ? 'leave' : 'arrive',
    at: r.at,
    forwardedAt: r.forwardedAt,
    whatsappSent: Array.isArray(r.whatsappSent) ? r.whatsappSent : [],
  }));

  // Labels and flags as they are now, for any place an event names —
  // including one un-flagged since, which then simply gets no WhatsApp.
  const home = await getHomePlace();
  const placeRows = await db
    .select({
      id: daydreamPlaces.id,
      lat: daydreamPlaces.lat,
      lon: daydreamPlaces.lon,
      radiusM: daydreamPlaces.radiusM,
      label: daydreamPlaces.label,
      whatsappAlerts: daydreamPlaces.whatsappAlerts,
    })
    .from(daydreamPlaces)
    .where(inArray(daydreamPlaces.id, [...new Set(events.map((e) => e.placeId))]));
  const places = new Map(placeRows.map((p) => [p.id, { ...p, isHome: p.id === home?.id } as AlertPlace]));

  // The app.
  const owed = events.filter((e) => isDeliverable(e, now));
  if (owed.length && pilotToken()) {
    const { send, nobody } = buildPilotEvents(owed, places, members);
    const done = [...nobody];
    if (send.length) {
      const res = await postToPilot(send, deps.fetchImpl);
      if (res) {
        // The pilot saw the (possibly trimmed) id; map it back.
        const accepted = new Set(res.accepted);
        for (const e of owed) if (accepted.has(e.id.slice(0, 100))) done.push(e.id);
        result.forwarded = res.accepted.length;
        if (res.error) result.pilotError = res.error.slice(0, 200);
      }
    }
    result.unfollowed = nobody.length;
    if (done.length) {
      await db.update(householdEvent).set({ forwardedAt: now }).where(inArray(householdEvent.id, done));
    }
  }

  // WhatsApp, for flagged places only.
  for (const s of planWhatsApp(events, places, members, now)) {
    let ok = false;
    try {
      const r = await sendWhatsApp(s.number, s.text);
      ok = r.sent;
    } catch {
      ok = false;
    }
    if (!ok) {
      result.whatsappFailed.push(maskNumber(s.number));
      continue;
    }
    result.whatsappSent.push(maskNumber(s.number));
    await db
      .update(householdEvent)
      .set({ whatsappSent: sql`${householdEvent.whatsappSent} || ${JSON.stringify([s.recipient])}::jsonb` })
      .where(eq(householdEvent.id, s.eventId));
  }
  return result;
}
