// src/lib/home/presence/live-journey.ts
//
// A family member on the move, live on the Lock Screen of each person who
// follows them — an ActivityKit Live Activity the site starts, updates and
// ends by push, with the app closed.
//
//  - STARTED by a departure from a flagged place: the same `household_event`
//    the time-sensitive "Sam left School" push is raised from. The journey's
//    id is that crossing's id, so one departure is one journey however many
//    runs see it. Started with ActivityKit's push-to-start token, which the
//    app registers (`native_credentials.la_start_token`).
//  - UPDATED each home-observe run (every two minutes) from the mover's newest
//    trail fix — distance from home, how they are moving, a rough ETA — and
//    only when what the Lock Screen shows would change, which keeps well
//    inside Apple's update budget. Sent to each activity's own update token,
//    which the app reports back once the activity exists.
//  - ENDED by their next arrival anywhere watched ("Sam arrived at Home"),
//    kept on screen fifteen minutes; by a newer departure; by the mover no
//    longer sharing (removed at once); or after two hours ("last seen").
//
// Who sees it is exactly who gets the departure alert: followers on the app
// (`pilotRecipients`), never the mover, never a mover who is silenced or held.
// Only phones with a SITE pairing hold a token, as for every other push.
//
// Distances are straight lines and the ETA is a straight line at the current
// speed with a 1.3 road factor. Both say "~" on the phone; neither is routing.

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, ne, notLike } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '$lib/db';
import { daydreamTrail, householdEvent, householdJourney, householdJourneyViewer, nativeCredentials } from '$lib/db/schema';
import { isApnsConfigured, isDeadToken, isDeviceToken, sendLiveActivity, type ApnsEnv, type ApnsResult } from '$lib/server/apns';
import { metresBetween } from './cluster';
import { raisesCrossing } from './crossings';
import { displayNameOf, loadAlertPlaces, localClock, partitionMovers, pilotRecipients, placeName } from './alerts';
import { loadCompanionUsers } from './companion';
import { getHomePlace } from './places';
import { listMembers, type HouseholdMember } from './members';
import { familyRole } from '$lib/server/family-access';
import { isOwnerEmail } from '$lib/server/access';
import { errMsg } from './types';

/** A departure older than this when first seen does not start a journey. */
export const START_WINDOW_MS = 15 * 60_000;
/** A journey with no arrival is closed after this. */
export const JOURNEY_MAX_MS = 2 * 60 * 60_000;
/** An arrival stays on the Lock Screen this long. */
const ARRIVED_KEEP_S = 15 * 60;
/** Without an update this long, the phone greys the activity out. */
const STALE_AFTER_S = 20 * 60;
/** A fix older than this is shown as "last seen". */
const OLD_FIX_MS = 10 * 60_000;
/** Inside this of home's centre reads "nearly home". */
const NEARLY_HOME_M = 250;
const ROAD_FACTOR = 1.3;
export const TEST_SUBJECT = '__test__';

/** The activity's fixed half — `JourneyAttributes` in the app. */
export interface JourneyAttributes {
  journeyId: string;
  name: string;
  fromPlace: string;
  /** Epoch seconds. */
  startedAt: number;
}

/**
 * The half that changes — `JourneyAttributes.ContentState` in the app. Keys
 * must match the Swift property names exactly: ActivityKit decodes this JSON
 * straight into the struct, and one renamed key drops the whole push.
 * Times are epoch SECONDS (ActivityKit's own date decoding is not epoch).
 */
export interface JourneyContent {
  phase: 'moving' | 'arrived' | 'ended';
  headline: string;
  detail: string;
  distanceHomeM: number | null;
  /** 0–1 toward home; null when the journey started at home. */
  progress: number | null;
  etaMinutes: number | null;
  mode: string | null;
  updatedAt: number;
}

export interface JourneyFix {
  lat: number;
  lon: number;
  ts: Date;
  speedKmh: number | null;
  mode: string | null;
}

// ── Pure pieces ──────────────────────────────────────────────────────────────

/** "650 m", "2.4 km", "18 km". PURE. */
export function distanceText(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

/** The trail's coarse mode, as colour. PURE. */
export function modeText(mode: string | null): string | null {
  switch (mode) {
    case 'walking':
      return 'walking';
    case 'active':
      return 'on the move';
    case 'vehicle':
      return 'by road';
    case 'rail':
      return 'travelling fast';
    case 'still':
      return 'stopped';
    default:
      return null;
  }
}

/**
 * What the Lock Screen says while they are on the way. PURE.
 *
 * Toward home when the journey started somewhere else: distance, a progress
 * bar against the distance at the start, and an ETA while they are moving.
 * From home: how far from home, and how they are moving — there is no
 * destination to count down to.
 */
export function movingContent(input: {
  name: string;
  fromPlace: string;
  fromHome: boolean;
  fix: JourneyFix | null;
  home: { lat: number; lon: number } | null;
  homeStartM: number | null;
  now: Date;
}): JourneyContent {
  const { fix, home } = input;
  const distanceHomeM = fix && home ? Math.round(metresBetween(fix.lat, fix.lon, home.lat, home.lon)) : null;
  const toward = !input.fromHome && distanceHomeM != null;
  const progress =
    toward && input.homeStartM && input.homeStartM > 0
      ? Math.min(1, Math.max(0, 1 - (distanceHomeM as number) / input.homeStartM))
      : null;
  const moving = fix && fix.mode !== 'still' && (fix.speedKmh ?? 0) >= 3;
  const etaMinutes =
    toward && moving && (distanceHomeM as number) > NEARLY_HOME_M
      ? Math.min(180, Math.max(1, Math.round((((distanceHomeM as number) * ROAD_FACTOR) / 1000 / (fix!.speedKmh as number)) * 60)))
      : null;

  const parts: string[] = [];
  if (distanceHomeM != null) {
    parts.push(toward && distanceHomeM <= NEARLY_HOME_M ? 'nearly home' : `${distanceText(distanceHomeM)} from home`);
  }
  const how = modeText(fix?.mode ?? null);
  if (how) parts.push(how);
  if (etaMinutes != null) parts.push(`~${etaMinutes} min`);
  if (fix && input.now.getTime() - fix.ts.getTime() > OLD_FIX_MS) parts.push(`last seen ${localClock(fix.ts)}`);

  return {
    phase: 'moving',
    headline: `${input.name} left ${input.fromPlace}`.slice(0, 80),
    detail: (parts.join(' · ') || 'on the way').slice(0, 120),
    distanceHomeM,
    progress: progress == null ? null : Math.round(progress * 100) / 100,
    etaMinutes,
    mode: fix?.mode ?? null,
    updatedAt: Math.floor((fix?.ts ?? input.now).getTime() / 1000),
  };
}

/** The last thing shown: arrived somewhere, or given up on. PURE. */
export function endContent(
  input: { name: string; fromPlace: string; last: JourneyContent | null },
  end: { kind: 'arrived'; place: string; isHome: boolean; at: Date } | { kind: 'ended'; lastSeen: Date | null },
): JourneyContent {
  if (end.kind === 'arrived') {
    return {
      phase: 'arrived',
      headline: `${input.name} arrived at ${end.place}`.slice(0, 80),
      detail: `at ${localClock(end.at)}`,
      distanceHomeM: end.isHome ? 0 : null,
      progress: end.isHome ? 1 : input.last?.progress ?? null,
      etaMinutes: null,
      mode: null,
      updatedAt: Math.floor(end.at.getTime() / 1000),
    };
  }
  return {
    ...(input.last ?? movingContent({ name: input.name, fromPlace: input.fromPlace, fromHome: true, fix: null, home: null, homeStartM: null, now: end.lastSeen ?? new Date() })),
    phase: 'ended',
    detail: end.lastSeen ? `last seen ${localClock(end.lastSeen)}` : 'no longer followed',
    etaMinutes: null,
  };
}

/** How far apart two distances must be to be worth a push. PURE. */
function bucket(m: number | null): number | null {
  if (m == null) return null;
  return m < 2000 ? Math.round(m / 100) : 20 + Math.round(m / 500);
}

/**
 * Whether the Lock Screen would look different. PURE. Distance in 100 m steps
 * under 2 km and 500 m steps above, the ETA by two minutes, and any change of
 * phase, mode or "last seen" — anything finer is a push nobody would notice,
 * spent from Apple's budget.
 */
export function worthPushing(prev: JourneyContent | null, next: JourneyContent): boolean {
  if (!prev) return true;
  if (prev.phase !== next.phase || prev.mode !== next.mode) return true;
  if (bucket(prev.distanceHomeM) !== bucket(next.distanceHomeM)) return true;
  if ((prev.etaMinutes == null) !== (next.etaMinutes == null)) return true;
  if (prev.etaMinutes != null && next.etaMinutes != null && Math.abs(prev.etaMinutes - next.etaMinutes) >= 2) return true;
  return prev.detail.includes('last seen') !== next.detail.includes('last seen');
}

/** ActivityKit's `aps` for each of the three events. PURE. */
export function startAps(attributes: JourneyAttributes, content: JourneyContent, now: Date): Record<string, unknown> {
  const t = Math.floor(now.getTime() / 1000);
  return {
    timestamp: t,
    event: 'start',
    'content-state': content,
    'attributes-type': 'JourneyAttributes',
    attributes,
    // Quiet: the time-sensitive "left" banner already rang; this only puts
    // the journey on screen.
    alert: { title: content.headline, body: content.detail },
    'stale-date': t + STALE_AFTER_S,
    'relevance-score': 100,
  };
}

export function updateAps(content: JourneyContent, now: Date): Record<string, unknown> {
  const t = Math.floor(now.getTime() / 1000);
  return { timestamp: t, event: 'update', 'content-state': content, 'stale-date': t + STALE_AFTER_S };
}

export function endAps(content: JourneyContent, now: Date, keepSeconds: number): Record<string, unknown> {
  const t = Math.floor(now.getTime() / 1000);
  return { timestamp: t, event: 'end', 'content-state': content, 'dismissal-date': t + keepSeconds };
}

// ── Tokens ───────────────────────────────────────────────────────────────────

export type LiveSender = (token: string, aps: Record<string, unknown>, env?: ApnsEnv | null) => Promise<ApnsResult>;

const envOf = (v: string | null): ApnsEnv | null => (v === 'sandbox' ? 'sandbox' : v === 'production' ? 'production' : null);

/** The app's push-to-start token for journeys, on this phone's credential. */
export async function registerLiveStartToken(deviceId: string, token: string): Promise<void> {
  if (!isDeviceToken(token)) throw new Error('Not a Live Activity token.');
  await db
    .update(nativeCredentials)
    .set({ laStartToken: token.toLowerCase(), laStartTokenAt: new Date() })
    .where(eq(nativeCredentials.id, deviceId));
}

/** One activity's update token, reported by the app once the activity exists. */
export async function registerJourneyToken(journeyId: string, deviceId: string, token: string): Promise<boolean> {
  if (!isDeviceToken(token) || !journeyId || journeyId.length > 200) return false;
  const [viewer] = await db.select({ email: nativeCredentials.ownerEmail, subject: householdJourney.subject, liveActivityEnabled: nativeCredentials.liveActivityEnabled })
    .from(householdJourneyViewer)
    .innerJoin(householdJourney, eq(householdJourney.id, householdJourneyViewer.journeyId))
    .innerJoin(nativeCredentials, eq(nativeCredentials.id, householdJourneyViewer.deviceId))
    .where(and(eq(householdJourneyViewer.journeyId, journeyId), eq(householdJourneyViewer.deviceId, deviceId),
      eq(nativeCredentials.kind, 'device'), eq(nativeCredentials.liveActivityEnabled, true), isNull(nativeCredentials.revokedAt), gt(nativeCredentials.expiresAt, new Date()),
      isNull(householdJourney.endedAt))).limit(1);
  if (!viewer || !(await journeyAccess(viewer.subject, viewer.email))) return false;
  const rows = await db.update(householdJourneyViewer)
    .set({ updateToken: token.toLowerCase(), updateTokenAt: new Date() })
    .where(and(eq(householdJourneyViewer.journeyId, journeyId), eq(householdJourneyViewer.deviceId, deviceId)))
    .returning({ deviceId: householdJourneyViewer.deviceId });
  return rows.length > 0;
}

/** Current reader permission, follow relationship and mover consent, fail closed. */
export async function journeyAccess(subject: string, email: string): Promise<boolean> {
  try {
    if (subject === TEST_SUBJECT) return isOwnerEmail(email);
    if (!(await familyRole(email))) return false;
    const members = await listMembers();
    if (!pilotRecipients(members, subject).some(e => e.toLowerCase() === email.toLowerCase())) return false;
    const users = await loadCompanionUsers();
    const { silenced, held } = partitionMovers([{ subject }], members, users);
    return !silenced.has(subject) && !held.has(subject);
  } catch { return false; }
}

/** Phones of these people that can have a journey started on them. */
async function startTargets(emails: readonly string[]) {
  emails = (await Promise.all(emails.map(async e => await familyRole(e) ? e : null))).filter((e): e is string => e !== null);
  if (!emails.length) return [];
  return db
    .select({ id: nativeCredentials.id, token: nativeCredentials.laStartToken, env: nativeCredentials.apnsEnv, email: nativeCredentials.ownerEmail })
    .from(nativeCredentials)
    .where(
      and(
        eq(nativeCredentials.kind, 'device'),
        isNull(nativeCredentials.revokedAt),
        gt(nativeCredentials.expiresAt, new Date()),
        isNotNull(nativeCredentials.laStartToken),
        eq(nativeCredentials.liveActivityEnabled, true),
        inArray(nativeCredentials.ownerEmail, [...emails]),
      ),
    );
}

/** Start one journey on these phones; record the ones Apple took. */
async function startOn(
  journeyId: string,
  phones: Awaited<ReturnType<typeof startTargets>>,
  aps: Record<string, unknown>,
  send: LiveSender,
): Promise<number> {
  let started = 0;
  const [journey] = await db.select({ subject: householdJourney.subject }).from(householdJourney).where(eq(householdJourney.id, journeyId)).limit(1);
  for (const p of phones) {
    if (!p.token || !journey || !(await journeyAccess(journey.subject, p.email))) continue;
    // Record server authorisation before APNs: the phone may report its token
    // as soon as Apple accepts the start, before this send has returned.
    await db.insert(householdJourneyViewer).values({ journeyId, deviceId: p.id }).onConflictDoNothing();
    const result = await send(p.token, aps, envOf(p.env));
    if (!result.ok) await db.delete(householdJourneyViewer).where(and(eq(householdJourneyViewer.journeyId, journeyId), eq(householdJourneyViewer.deviceId, p.id)));
    if (result.ok) {
      started++;
    } else if (isDeadToken(result)) {
      await db.update(nativeCredentials).set({ laStartToken: null, laStartTokenAt: null }).where(eq(nativeCredentials.id, p.id));
    } else {
      console.warn(`[live-journey] start refused on ${p.id.slice(0, 8)}: ${result.status} ${result.reason ?? ''}`);
    }
  }
  return started;
}

/**
 * Start a journey that is not a departure — a route being walked
 * (`./route-session`) — on the phones of these followers, under the same
 * consent checks as any other.
 */
export async function startJourneyOn(
  journeyId: string,
  emails: readonly string[],
  aps: Record<string, unknown>,
  send: LiveSender = (t, a, env) => sendLiveActivity(t, a, env),
): Promise<number> {
  return startOn(journeyId, await startTargets(emails), aps, send);
}

/** Push to every phone showing this journey that reported an update token. */
export async function pushToViewers(journeyId: string, aps: Record<string, unknown>, send: LiveSender): Promise<number> {
  const viewers = await db
    .select({ deviceId: householdJourneyViewer.deviceId, token: householdJourneyViewer.updateToken, env: nativeCredentials.apnsEnv, email: nativeCredentials.ownerEmail, subject: householdJourney.subject, liveActivityEnabled: nativeCredentials.liveActivityEnabled })
    .from(householdJourneyViewer)
    .innerJoin(householdJourney, eq(householdJourney.id, householdJourneyViewer.journeyId))
    .innerJoin(nativeCredentials, eq(nativeCredentials.id, householdJourneyViewer.deviceId))
    .where(and(eq(householdJourneyViewer.journeyId, journeyId), isNotNull(householdJourneyViewer.updateToken), eq(nativeCredentials.kind, 'device'), isNull(nativeCredentials.revokedAt), gt(nativeCredentials.expiresAt, new Date())));
  let sent = 0;
  for (const v of viewers) {
    if (!v.token) continue;
    const permitted = v.liveActivityEnabled && await journeyAccess(v.subject, v.email);
    // A privacy change ends an existing activity with no retained personal state.
    const safeEnd = endAps({ phase: 'ended', headline: 'Journey ended', detail: '', distanceHomeM: null,
      progress: null, etaMinutes: null, mode: null, updatedAt: Math.floor(Date.now()/1000) }, new Date(), 0);
    const result = await send(v.token, permitted ? aps : safeEnd, envOf(v.env));
    if (!permitted) {
      await db.delete(householdJourneyViewer).where(and(eq(householdJourneyViewer.journeyId, journeyId), eq(householdJourneyViewer.deviceId, v.deviceId)));
    }
    if (result.ok) sent++;
    else if (isDeadToken(result)) {
      await db
        .update(householdJourneyViewer)
        .set({ updateToken: null })
        .where(and(eq(householdJourneyViewer.journeyId, journeyId), eq(householdJourneyViewer.deviceId, v.deviceId)));
    }
  }
  return sent;
}

// ── The run ──────────────────────────────────────────────────────────────────

async function latestFix(subject: string, since: Date): Promise<JourneyFix | null> {
  const [row] = await db
    .select({
      lat: daydreamTrail.lat,
      lon: daydreamTrail.lon,
      ts: daydreamTrail.ts,
      speedKmh: daydreamTrail.speedKmh,
      mode: daydreamTrail.mode,
    })
    .from(daydreamTrail)
    .where(
      and(
        eq(daydreamTrail.subject, subject),
        isNotNull(daydreamTrail.lat),
        ne(daydreamTrail.source, 'gap'),
        gte(daydreamTrail.ts, since),
      ),
    )
    .orderBy(desc(daydreamTrail.ts))
    .limit(1);
  if (!row || row.lat == null || row.lon == null) return null;
  return { lat: row.lat, lon: row.lon, ts: row.ts, speedKmh: row.speedKmh ?? null, mode: row.mode ?? null };
}

export interface LiveJourneyResult {
  started: number;
  updated: number;
  ended: number;
  errors: string[];
}

type JourneyRow = typeof householdJourney.$inferSelect;

async function close(
  j: JourneyRow,
  reason: string,
  content: JourneyContent,
  keepSeconds: number,
  now: Date,
  send: LiveSender,
  endPlaceId: string | null = null,
): Promise<void> {
  await pushToViewers(j.id, endAps(content, now, keepSeconds), send);
  await db
    .update(householdJourney)
    .set({ endedAt: now, endReason: reason, endPlaceId, state: content as unknown as Record<string, unknown>, updatedAt: now })
    .where(eq(householdJourney.id, j.id));
}

/**
 * One pass: start journeys for new departures, move the open ones on, close
 * the finished ones. Never throws; a failure for one journey is recorded and
 * the rest carry on.
 */
export async function runLiveJourneys(
  members: readonly HouseholdMember[],
  deps: { send?: LiveSender; now?: Date } = {},
): Promise<LiveJourneyResult> {
  const result: LiveJourneyResult = { started: 0, updated: 0, ended: 0, errors: [] };
  if (!deps.send && !isApnsConfigured()) return result;
  const send = deps.send ?? ((t, aps, env) => sendLiveActivity(t, aps, env));
  const now = deps.now ?? new Date();

  const places = new Map((await loadAlertPlaces()).map((p) => [p.id, p]));
  const home = await getHomePlace();
  let users: Awaited<ReturnType<typeof loadCompanionUsers>> = null;
  try {
    users = await loadCompanionUsers();
  } catch {
    users = null;
  }

  // ── Starts ──
  const departures = await db
    .select()
    .from(householdEvent)
    .where(and(eq(householdEvent.kind, 'leave'), gte(householdEvent.at, new Date(now.getTime() - START_WINDOW_MS))))
    .orderBy(asc(householdEvent.at));
  const { silenced, held } = partitionMovers(departures, members, users);
  for (const ev of departures) {
    try {
      const place = places.get(ev.placeId);
      if (silenced.has(ev.subject) || held.has(ev.subject) || !raisesCrossing(place, 'leave')) continue;
      const [exists] = await db.select({ id: householdJourney.id }).from(householdJourney).where(eq(householdJourney.id, ev.id)).limit(1);
      if (exists) continue;

      const name = displayNameOf(members, ev.subject);
      const fromPlace = placeName(place);
      // A newer departure replaces whatever journey they were on.
      // Not a route being walked: that is its own session (`./route-session`),
      // and leaving a place mid-walk is part of the walk.
      const open = await db
        .select()
        .from(householdJourney)
        .where(and(eq(householdJourney.subject, ev.subject), isNull(householdJourney.endedAt), notLike(householdJourney.id, 'route-%')));
      for (const j of open) {
        await close(j, 'superseded', endContent({ name, fromPlace, last: (j.state as unknown as JourneyContent) ?? null }, { kind: 'ended', lastSeen: null }), 0, now, send);
        result.ended++;
      }

      const fromHome = !!place?.isHome;
      const homeStartM = !fromHome && home && place ? Math.round(metresBetween(place.lat, place.lon, home.lat, home.lon)) : null;
      const fix = await latestFix(ev.subject, ev.at);
      const content = movingContent({ name, fromPlace, fromHome, fix, home, homeStartM, now });
      const inserted = await db
        .insert(householdJourney)
        .values({
          id: ev.id,
          subject: ev.subject,
          fromPlaceId: ev.placeId,
          startedAt: ev.at,
          homeStartM,
          state: content as unknown as Record<string, unknown>,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: householdJourney.id });
      if (!inserted.length) continue;

      const attributes: JourneyAttributes = { journeyId: ev.id, name, fromPlace, startedAt: Math.floor(ev.at.getTime() / 1000) };
      const phones = await startTargets(pilotRecipients(members, ev.subject).map((e) => e.trim().toLowerCase()));
      result.started += await startOn(ev.id, phones, startAps(attributes, content, now), send);
    } catch (err) {
      result.errors.push(`start ${ev.subject}: ${errMsg(err).slice(0, 120)}`);
    }
  }

  // ── Updates and ends ──
  const open = await db
    .select()
    .from(householdJourney)
    // Route sessions move on their walker's own fixes and end by their own
    // rules (`./route-session`); an arrival or this module's two hours must not
    // close them, nor a straight-line-home reading overwrite their card.
    .where(and(isNull(householdJourney.endedAt), ne(householdJourney.subject, TEST_SUBJECT), notLike(householdJourney.id, 'route-%')));
  for (const j of open) {
    try {
      const name = displayNameOf(members, j.subject);
      const fromPlace = placeName(places.get(j.fromPlaceId));
      const last = (j.state as unknown as JourneyContent) ?? null;

      if (silenced.has(j.subject) || held.has(j.subject) || !members.some((m) => m.subject === j.subject)) {
        await close(j, 'silenced', endContent({ name, fromPlace, last }, { kind: 'ended', lastSeen: null }), 0, now, send);
        result.ended++;
        continue;
      }

      const [arrival] = await db
        .select()
        .from(householdEvent)
        .where(and(eq(householdEvent.subject, j.subject), eq(householdEvent.kind, 'arrive'), gt(householdEvent.at, j.startedAt)))
        .orderBy(asc(householdEvent.at))
        .limit(1);
      if (arrival) {
        const at = places.get(arrival.placeId);
        const content = endContent({ name, fromPlace, last }, { kind: 'arrived', place: placeName(at), isHome: !!at?.isHome, at: arrival.at });
        await close(j, 'arrived', content, ARRIVED_KEEP_S, now, send, arrival.placeId);
        result.ended++;
        continue;
      }

      const fix = await latestFix(j.subject, j.startedAt);
      if (now.getTime() - j.startedAt.getTime() > JOURNEY_MAX_MS) {
        await close(j, 'timeout', endContent({ name, fromPlace, last }, { kind: 'ended', lastSeen: fix?.ts ?? null }), 5 * 60, now, send);
        result.ended++;
        continue;
      }

      const place = places.get(j.fromPlaceId);
      const next = movingContent({ name, fromPlace, fromHome: !!place?.isHome, fix, home, homeStartM: j.homeStartM, now });
      if (!worthPushing(last, next)) continue;
      await pushToViewers(j.id, updateAps(next, now), send);
      await db
        .update(householdJourney)
        .set({ state: next as unknown as Record<string, unknown>, updatedAt: now })
        .where(eq(householdJourney.id, j.id));
      result.updated++;
    } catch (err) {
      result.errors.push(`${j.subject}: ${errMsg(err).slice(0, 120)}`);
    }
  }
  return result;
}

// ── The owner's test ─────────────────────────────────────────────────────────

/**
 * A pretend journey on THIS phone, for checking the wiring end to end without
 * waiting for somebody to leave school: started, moved on twice, then
 * arrived, over about a minute. Needs the app to have registered its
 * push-to-start token; the updates need it to have reported the activity's
 * own token, which is exactly what is being checked.
 */
export async function startTestJourney(deviceId: string, send: LiveSender = (t, aps, env) => sendLiveActivity(t, aps, env)): Promise<ApnsResult | null> {
  const [phone] = await db
    .select({ id: nativeCredentials.id, token: nativeCredentials.laStartToken, env: nativeCredentials.apnsEnv, email: nativeCredentials.ownerEmail })
    .from(nativeCredentials)
    .where(eq(nativeCredentials.id, deviceId))
    .limit(1);
  if (!phone?.token) return null;

  const now = new Date();
  const id = `test-${randomBytes(6).toString('hex')}`;
  const name = 'Test';
  const fromPlace = 'School';
  await db.insert(householdJourney).values({ id, subject: TEST_SUBJECT, fromPlaceId: 'test', startedAt: now, homeStartM: 2400 });
  const step = (distanceHomeM: number, etaMinutes: number, at: Date): JourneyContent => ({
    phase: 'moving',
    headline: `${name} left ${fromPlace}`,
    detail: `${distanceText(distanceHomeM)} from home · walking · ~${etaMinutes} min`,
    distanceHomeM,
    progress: Math.round((1 - distanceHomeM / 2400) * 100) / 100,
    etaMinutes,
    mode: 'walking',
    updatedAt: Math.floor(at.getTime() / 1000),
  });
  const attributes: JourneyAttributes = { journeyId: id, name, fromPlace, startedAt: Math.floor(now.getTime() / 1000) };
  const first = await send(phone.token, startAps(attributes, step(2400, 30, now), now), envOf(phone.env));
  if (!first.ok) {
    await db.update(householdJourney).set({ endedAt: new Date(), endReason: 'test' }).where(eq(householdJourney.id, id));
    return first;
  }
  await db.insert(householdJourneyViewer).values({ journeyId: id, deviceId }).onConflictDoNothing();

  const later = (ms: number, fn: () => Promise<unknown>) => {
    const t = setTimeout(() => void fn().catch((e) => console.error('[live-journey] test step failed', errMsg(e))), ms);
    t.unref?.();
  };
  later(20_000, () => pushToViewers(id, updateAps(step(1200, 15, new Date()), new Date()), send));
  later(40_000, () => pushToViewers(id, updateAps(step(300, 4, new Date()), new Date()), send));
  later(60_000, async () => {
    const done = endContent({ name, fromPlace, last: null }, { kind: 'arrived', place: 'Home', isHome: true, at: new Date() });
    await pushToViewers(id, endAps(done, new Date(), 5 * 60), send);
    await db.update(householdJourney).set({ endedAt: new Date(), endReason: 'test' }).where(eq(householdJourney.id, id));
  });
  return first;
}

