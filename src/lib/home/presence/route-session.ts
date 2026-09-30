// src/lib/home/presence/route-session.ts
//
// Somebody walking a saved route, followed live by their family — the fourth
// phase of the route planner on the SR app.
//
//  - STARTED from the walker's phone ("Track me live"), with the route's line
//    as the phone holds it. The walker must be a household member, since
//    followers are exactly the people who follow them for departures
//    (`pilotRecipients`), under the same consent (`journeyAccess`).
//  - FED by the walker's phone every ~15 s: a batch of fixes and the phone's
//    own reading of the route — along, left, off the line, time left. The
//    phone is the one following the route, offline included, so its reading
//    is the reading; the server does not second-guess it with a coarser copy.
//  - SHOWN three ways: the family-journey Live Activity on followers' Lock
//    Screens (this session IS a `household_journey`, id `route-…`, so its
//    tokens, viewers and consent checks are that module's); the app's own
//    follow screen; and, if the walker asked, a link for someone without the
//    app (`/follow/<token>`).
//  - ENDED by the walker (finished / stopped), by 30 minutes with no fix
//    ('stale'), or at six hours ('timeout'). The share link dies with it.
//
// Nothing here is a Live Activity CONTRACT change: route progress rides in the
// fields the card already draws — `progress` is the share of the route done,
// `etaMinutes` the time left, `detail` "6.2 of 10 km". A finish is phase
// `ended`, never `arrived`, whose card says "Home".

import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '$lib/db';
import { householdJourney, routeSession } from '$lib/db/schema';
import { isApnsConfigured, sendLiveActivity } from '$lib/server/apns';
import {
  distanceText,
  endAps,
  pushToViewers,
  startAps,
  startJourneyOn,
  updateAps,
  type JourneyAttributes,
  type JourneyContent,
  type LiveSender,
} from './live-journey';
import { localClock, pilotRecipients } from './alerts';
import type { HouseholdMember } from './members';
import { errMsg } from './types';

export const ROUTE_JOURNEY_PREFIX = 'route-';
/** No fix for this long ends the session. */
export const STALE_MS = 30 * 60_000;
/** However it is going, a session ends at this age. */
export const SESSION_MAX_MS = 6 * 60 * 60_000;
/** A fix older than this reads "last seen". */
const OLD_FIX_MS = 10 * 60_000;
export const ROUTE_MAX_POINTS = 600;
export const TRAIL_MAX_POINTS = 2000;
const FINISHED_KEEP_S = 15 * 60;

/** The walker's phone's reading of the route, as it sends it. */
export interface RouteReading {
  alongM: number;
  remainingM: number;
  offRouteM: number;
  offRoute: boolean;
  /** Seconds, Naismith on what is left. Null before the first fix. */
  timeLeftS: number | null;
}

export interface RouteFix {
  lat: number;
  lng: number;
  /** Epoch seconds. */
  t: number;
}

type SessionRow = typeof routeSession.$inferSelect;

// ── Pure pieces ──────────────────────────────────────────────────────────────

const km = (m: number) => (m < 10_000 ? (m / 1000).toFixed(1) : String(Math.round(m / 1000)));

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Walk or hike walks; everything else is the card's "on the move". PURE. */
export function cardMode(sport: string): string {
  return sport === 'walk' || sport === 'hike' ? 'walking' : 'active';
}

/** What the Lock Screen says while they are on the route. PURE. */
export function routeContent(input: {
  name: string;
  routeName: string;
  sport: string;
  totalM: number;
  reading: RouteReading | null;
  lastFixAt: Date | null;
  now: Date;
}): JourneyContent {
  const r = input.reading;
  const progress = r && input.totalM > 0 ? Math.round(Math.min(1, Math.max(0, r.alongM / input.totalM)) * 100) / 100 : 0;
  const etaMinutes =
    r?.timeLeftS != null && !r.offRoute && r.remainingM > 50 ? Math.min(600, Math.max(1, Math.round(r.timeLeftS / 60))) : null;
  const parts: string[] = [];
  if (r?.offRoute) parts.push(`off route · ${distanceText(r.offRouteM)} from the line`);
  else if (r) parts.push(`${km(r.alongM)} of ${km(input.totalM)} km`);
  else parts.push(`${km(input.totalM)} km route · starting`);
  if (etaMinutes != null) parts.push(`~${etaMinutes} min left`);
  if (input.lastFixAt && input.now.getTime() - input.lastFixAt.getTime() > OLD_FIX_MS) {
    parts.push(`last seen ${localClock(input.lastFixAt)}`);
  }
  return {
    phase: 'moving',
    headline: `${firstName(input.name)} · ${input.routeName}`.slice(0, 80),
    detail: parts.join(' · ').slice(0, 120),
    distanceHomeM: null,
    progress,
    etaMinutes,
    mode: cardMode(input.sport),
    updatedAt: Math.floor((input.lastFixAt ?? input.now).getTime() / 1000),
  };
}

/** The last card: finished the route, or stopped following. PURE. */
export function routeEndContent(
  input: { name: string; routeName: string; sport: string; totalM: number; last: JourneyContent | null },
  reason: 'finished' | 'stopped' | 'stale' | 'timeout',
  at: Date,
  lastFixAt: Date | null,
): JourneyContent {
  const detail =
    reason === 'finished'
      ? `finished at ${localClock(at)}`
      : reason === 'stopped'
        ? `stopped sharing at ${localClock(at)}`
        : lastFixAt
          ? `last seen ${localClock(lastFixAt)}`
          : 'no longer followed';
  return {
    phase: 'ended',
    headline: input.last?.headline ?? `${firstName(input.name)} · ${input.routeName}`.slice(0, 80),
    detail,
    distanceHomeM: null,
    progress: reason === 'finished' ? 1 : input.last?.progress ?? null,
    etaMinutes: null,
    mode: cardMode(input.sport),
    updatedAt: Math.floor(at.getTime() / 1000),
  };
}

/** 100 m steps under 2 km done, 250 m above — the bar would not move for less. PURE. */
function bucket(progress: number | null, totalM: number): number | null {
  if (progress == null) return null;
  const along = progress * totalM;
  return along < 2000 ? Math.round(along / 100) : 20 + Math.round(along / 250);
}

/** Whether the card would look different. PURE. */
export function routeWorthPushing(prev: JourneyContent | null, next: JourneyContent, totalM: number): boolean {
  if (!prev) return true;
  if (prev.phase !== next.phase) return true;
  if (prev.detail.startsWith('off route') !== next.detail.startsWith('off route')) return true;
  if (bucket(prev.progress, totalM) !== bucket(next.progress, totalM)) return true;
  if ((prev.etaMinutes == null) !== (next.etaMinutes == null)) return true;
  if (prev.etaMinutes != null && next.etaMinutes != null && Math.abs(prev.etaMinutes - next.etaMinutes) >= 3) return true;
  return prev.detail.includes('last seen') !== next.detail.includes('last seen');
}

/** Whether an open session has run its course, and why. PURE. */
export function sweepReason(s: Pick<SessionRow, 'startedAt' | 'lastFixAt'>, now: Date): 'stale' | 'timeout' | null {
  if (now.getTime() - s.startedAt.getTime() > SESSION_MAX_MS) return 'timeout';
  const quietSince = s.lastFixAt ?? s.startedAt;
  if (now.getTime() - quietSince.getTime() > STALE_MS) return 'stale';
  return null;
}

/** Keep the ends and an even spread between. PURE. */
export function thin<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return items.slice();
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return out;
}

const isLat = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 90;
const isLng = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 180;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

/** The phone's route line, checked and thinned. PURE. */
export function readRouteLine(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw)) return null;
  const line: [number, number][] = [];
  for (const p of raw) if (Array.isArray(p) && isLat(p[0]) && isLng(p[1])) line.push([round5(p[0]), round5(p[1])]);
  return line.length >= 2 ? thin(line, ROUTE_MAX_POINTS) : null;
}

/** A batch of fixes and a reading, checked. PURE. */
export function readFixes(body: unknown, now: Date): { fixes: RouteFix[]; reading: RouteReading | null } {
  const b = (body ?? {}) as Record<string, unknown>;
  const fixes: RouteFix[] = [];
  const nowS = now.getTime() / 1000;
  for (const f of Array.isArray(b.fixes) ? b.fixes.slice(0, 500) : []) {
    const x = f as Record<string, unknown>;
    const t = num(x.t);
    // A fix from the future, or from before the session could exist, is a clock fault.
    if (!isLat(x.lat) || !isLng(x.lng) || t == null || t > nowS + 120 || t < nowS - SESSION_MAX_MS / 1000) continue;
    fixes.push({ lat: round5(x.lat), lng: round5(x.lng), t: Math.round(t) });
  }
  fixes.sort((a, z) => a.t - z.t);
  const r = (b.progress ?? null) as Record<string, unknown> | null;
  const alongM = num(r?.alongM);
  const remainingM = num(r?.remainingM);
  const offRouteM = num(r?.offRouteM);
  const reading: RouteReading | null =
    alongM != null && remainingM != null && offRouteM != null
      ? {
          alongM: Math.max(0, alongM),
          remainingM: Math.max(0, remainingM),
          offRouteM: Math.max(0, offRouteM),
          offRoute: r?.offRoute === true,
          timeLeftS: num(r?.timeLeftS),
        }
      : null;
  return { fixes, reading };
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 256 bits, url-safe. The only copy is the walker's; the database holds its hash. */
export function newShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

// ── Database ─────────────────────────────────────────────────────────────────

const defaultSend: LiveSender = (t, aps, env) => sendLiveActivity(t, aps, env);

function memberFor(members: readonly HouseholdMember[], email: string): HouseholdMember | null {
  const e = email.trim().toLowerCase();
  return members.find((m) => (m.email ?? '').toLowerCase() === e) ?? null;
}

export interface StartInput {
  walkerEmail: string;
  deviceId: string;
  routeId: string | null;
  routeName: string;
  sport: string;
  route: [number, number][];
  totalM: number;
  share: boolean;
}

/**
 * Open a session and put it on the followers' Lock Screens. Any earlier open
 * session of the same walker is ended first — one person, one live route.
 * Returns the share token once, or null when none was asked for.
 */
export async function startRouteSession(
  input: StartInput,
  members: readonly HouseholdMember[],
  deps: { send?: LiveSender; now?: Date; startOnFollowers?: (journeyId: string, emails: string[], aps: Record<string, unknown>) => Promise<number> } = {},
): Promise<{ id: string; shareToken: string | null; followers: number } | { error: string }> {
  const walker = memberFor(members, input.walkerEmail);
  if (!walker) return { error: 'Only someone in the family circle can be followed.' };
  const now = deps.now ?? new Date();
  const send = deps.send ?? defaultSend;

  const open = await db
    .select()
    .from(routeSession)
    .where(and(eq(routeSession.subject, walker.subject), isNull(routeSession.endedAt)));
  for (const s of open) await endRouteSession(s.id, 'stopped', { send, now });

  const id = `${ROUTE_JOURNEY_PREFIX}${randomBytes(9).toString('base64url')}`;
  const shareToken = input.share ? newShareToken() : null;
  const content = routeContent({
    name: walker.displayName, routeName: input.routeName, sport: input.sport, totalM: input.totalM,
    reading: null, lastFixAt: null, now,
  });
  await db.insert(routeSession).values({
    id,
    subject: walker.subject,
    walkerEmail: input.walkerEmail.trim().toLowerCase(),
    deviceId: input.deviceId,
    routeId: input.routeId,
    routeName: input.routeName.slice(0, 120),
    sport: input.sport,
    route: input.route,
    totalM: input.totalM,
    trail: [],
    startedAt: now,
    shareTokenHash: shareToken ? hashShareToken(shareToken) : null,
    shareExpiresAt: shareToken ? new Date(now.getTime() + SESSION_MAX_MS) : null,
  });
  // The journey row is what the Live Activity machinery keys on. `fromPlaceId`
  // names the route so nothing mistakes it for a place.
  await db.insert(householdJourney).values({
    id,
    subject: walker.subject,
    fromPlaceId: `route:${input.routeId ?? 'unsaved'}`,
    startedAt: now,
    homeStartM: null,
    state: content as unknown as Record<string, unknown>,
    updatedAt: now,
  });

  let followers = 0;
  if (deps.startOnFollowers || isApnsConfigured()) {
    const attributes: JourneyAttributes = { journeyId: id, name: walker.displayName, fromPlace: input.routeName, startedAt: Math.floor(now.getTime() / 1000) };
    const emails = pilotRecipients(members, walker.subject).map((e) => e.trim().toLowerCase());
    const start = deps.startOnFollowers ?? ((j: string, e: string[], aps: Record<string, unknown>) => startJourneyOn(j, e, aps, send));
    try {
      followers = await start(id, emails, startAps(attributes, content, now));
    } catch (err) {
      console.warn('[route-session] start on followers failed:', errMsg(err));
    }
  }
  return { id, shareToken, followers };
}

/** Append fixes, keep the phone's reading, and move the card on if it changed. */
export async function recordRouteFixes(
  id: string,
  deviceId: string,
  body: unknown,
  members: readonly HouseholdMember[],
  deps: { send?: LiveSender; now?: Date } = {},
): Promise<{ ok: true; ended: boolean } | { error: string; status: number }> {
  const now = deps.now ?? new Date();
  const [s] = await db.select().from(routeSession).where(eq(routeSession.id, id)).limit(1);
  if (!s || s.deviceId !== deviceId) return { error: 'No such session.', status: 404 };
  if (s.endedAt) return { ok: true, ended: true };
  const { fixes, reading } = readFixes(body, now);
  const trail = [...(s.trail ?? []), ...fixes.map((f) => [f.lat, f.lng, f.t] as [number, number, number])];
  const kept = trail.length > TRAIL_MAX_POINTS ? thin(trail, TRAIL_MAX_POINTS) : trail;
  const lastFixAt = fixes.length ? new Date(fixes[fixes.length - 1].t * 1000) : s.lastFixAt;
  await db
    .update(routeSession)
    .set({ trail: kept, lastFixAt, progress: (reading ?? s.progress) as Record<string, unknown> | null })
    .where(eq(routeSession.id, id));

  const name = members.find((m) => m.subject === s.subject)?.displayName ?? s.subject;
  const next = routeContent({
    name, routeName: s.routeName, sport: s.sport, totalM: s.totalM,
    reading: reading ?? (s.progress as unknown as RouteReading | null), lastFixAt, now,
  });
  const [j] = await db.select({ state: householdJourney.state }).from(householdJourney).where(eq(householdJourney.id, id)).limit(1);
  const last = (j?.state as unknown as JourneyContent) ?? null;
  if (routeWorthPushing(last, next, s.totalM)) {
    if (deps.send || isApnsConfigured()) await pushToViewers(id, updateAps(next, now), deps.send ?? defaultSend);
    await db
      .update(householdJourney)
      .set({ state: next as unknown as Record<string, unknown>, updatedAt: now })
      .where(eq(householdJourney.id, id));
  }
  return { ok: true, ended: false };
}

/** Close a session: the card's last word, the share link dead, the journey shut. */
export async function endRouteSession(
  id: string,
  reason: 'finished' | 'stopped' | 'stale' | 'timeout',
  deps: { send?: LiveSender; now?: Date; members?: readonly HouseholdMember[] } = {},
): Promise<boolean> {
  const now = deps.now ?? new Date();
  const [s] = await db.select().from(routeSession).where(eq(routeSession.id, id)).limit(1);
  if (!s || s.endedAt) return false;
  await db
    .update(routeSession)
    .set({ endedAt: now, endReason: reason, shareTokenHash: null, shareExpiresAt: null })
    .where(eq(routeSession.id, id));
  const [j] = await db.select({ state: householdJourney.state }).from(householdJourney).where(eq(householdJourney.id, id)).limit(1);
  const name = deps.members?.find((m) => m.subject === s.subject)?.displayName ?? s.subject;
  const content = routeEndContent(
    { name, routeName: s.routeName, sport: s.sport, totalM: s.totalM, last: (j?.state as unknown as JourneyContent) ?? null },
    reason, now, s.lastFixAt,
  );
  if (deps.send || isApnsConfigured()) {
    await pushToViewers(id, endAps(content, now, reason === 'finished' ? FINISHED_KEEP_S : 5 * 60), deps.send ?? defaultSend);
  }
  await db
    .update(householdJourney)
    .set({ endedAt: now, endReason: reason, state: content as unknown as Record<string, unknown>, updatedAt: now })
    .where(eq(householdJourney.id, id));
  return true;
}

/** Close sessions that went quiet or ran too long. Run from home-observe. Never throws. */
export async function sweepRouteSessions(
  members: readonly HouseholdMember[],
  deps: { send?: LiveSender; now?: Date } = {},
): Promise<{ ended: number; errors: string[] }> {
  const now = deps.now ?? new Date();
  const out = { ended: 0, errors: [] as string[] };
  try {
    const open = await db
      .select({ id: routeSession.id, startedAt: routeSession.startedAt, lastFixAt: routeSession.lastFixAt })
      .from(routeSession)
      .where(
        and(
          isNull(routeSession.endedAt),
          or(
            lt(routeSession.startedAt, new Date(now.getTime() - SESSION_MAX_MS)),
            lt(routeSession.lastFixAt, new Date(now.getTime() - STALE_MS)),
            and(isNull(routeSession.lastFixAt), lt(routeSession.startedAt, new Date(now.getTime() - STALE_MS))),
          ),
        ),
      );
    for (const s of open) {
      const reason = sweepReason(s, now);
      if (!reason) continue;
      try {
        if (await endRouteSession(s.id, reason, { ...deps, now, members })) out.ended++;
      } catch (err) {
        out.errors.push(`${s.id}: ${errMsg(err).slice(0, 100)}`);
      }
    }
  } catch (err) {
    out.errors.push(errMsg(err).slice(0, 120));
  }
  return out;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface RouteSessionView {
  id: string;
  name: string;
  routeName: string;
  sport: string;
  route: [number, number][];
  trail: [number, number, number][];
  totalM: number;
  progress: RouteReading | null;
  startedAt: string;
  lastFixAt: string | null;
  endedAt: string | null;
  endReason: string | null;
}

export function viewOf(s: SessionRow, members: readonly HouseholdMember[]): RouteSessionView {
  return {
    id: s.id,
    name: members.find((m) => m.subject === s.subject)?.displayName ?? s.subject,
    routeName: s.routeName,
    sport: s.sport,
    route: s.route,
    trail: s.trail ?? [],
    totalM: s.totalM,
    progress: (s.progress as unknown as RouteReading | null) ?? null,
    startedAt: s.startedAt.toISOString(),
    lastFixAt: s.lastFixAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
    endReason: s.endReason,
  };
}

export async function getRouteSession(id: string): Promise<SessionRow | null> {
  const [s] = await db.select().from(routeSession).where(eq(routeSession.id, id)).limit(1);
  return s ?? null;
}

export async function openRouteSessions(): Promise<SessionRow[]> {
  return db.select().from(routeSession).where(isNull(routeSession.endedAt));
}

/**
 * The public page's read: a LIVE session whose link has not expired, and only
 * what a stranger holding the link should see — the route, the latest
 * position, the progress and a first name. Never the trail: a link forwarded
 * on should not hand over where the walk started.
 */
export async function sharedRouteSession(token: string, now = new Date()) {
  if (!isShareToken(token)) return null;
  const [s] = await db
    .select()
    .from(routeSession)
    .where(and(eq(routeSession.shareTokenHash, hashShareToken(token)), isNull(routeSession.endedAt)))
    .limit(1);
  if (!s || !s.shareExpiresAt || s.shareExpiresAt.getTime() <= now.getTime()) return null;
  const last = s.trail?.[s.trail.length - 1] ?? null;
  return { session: s, last };
}

export { firstName };
