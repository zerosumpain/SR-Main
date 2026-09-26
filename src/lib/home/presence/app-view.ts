// src/lib/home/presence/app-view.ts
//
// The iPhone app's Family tab: a mini-map on Today, and a tab with where
// everyone is, their battery, and how today has gone.
//
// The app is paired with the PILOT, not the site — family members have no
// site pairing at all — so the view is built here and PUSHED to the pilot
// every observe cycle, the way arrive/leave alerts already are
// (`postToPilot`). The pilot files each view under its person and a phone can
// read only its own. That keeps the scoping in ONE place, this repo, next to
// the /home/people rules it has to agree with:
//
//   - who may see anything: `peopleViewerForEmail`, the page's rule from an
//     email (the owner, or a Family Circle member with a household row);
//   - what they see: `scopeHousehold` (spec D2) — everyone's live status and
//     battery, their own day (and a Family Admin's wards'), nothing of anyone
//     not sharing;
//   - where people are: `livePositions`, which never contains anyone not
//     sharing, whoever is looking — the same pins /home/people draws.
//
// Today's TRAIL is a history, not a position, so it rides with `today`: it is
// in a view exactly where the person's day is.
//
// Every view also says what the app may OFFER the person beyond the family
// (`access`: chat, news, … — `$lib/server/app-access`), and, for a member who
// has just asked, carries the one-time code that pairs their phone with the
// site (`sitePair`). That is the only way a member's code is ever minted: the
// owner mints his at /api/admin/native-devices, behind his session; a member
// has no page that could, so the push answers the app's request instead.

import { and, asc, gte, inArray, isNotNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail } from '$lib/db/schema';
import { companionToken, companionUrl, loadCompanionUsers, type HouseholdUser } from './companion';
import { inferMode } from './cluster';
import { distanceM } from './geo';
import { listPanelPlaces } from './places';
import { livePositions, loadHousehold, type LivePosition } from './household';
import type { HouseholdMember } from './members';
import { nowStatus, nowSub, type NowStatus } from './now';
import { ABSURD_SPEED_KMH, LOCAL_TZ, MAX_USABLE_ACCURACY_M, activeLabels, errMsg, localDayStart } from './types';
import { peopleViewerForEmail, scopeHousehold, type PeopleViewer, type ScopedPresence } from './viewer';
import { appAccessForEmail, type AppAccess } from '$lib/server/app-access';
import { createPairingCode, isPairingCodeLive } from '$lib/server/native-auth';

/** Two fixes further apart than this are not joined: the line would be a guess. */
export const TRAIL_GAP_S = 600;
/** Points sent per person. A day at a fix a minute is ~1,400; a phone map needs far fewer. */
export const TRAIL_MAX_POINTS = 300;
const PUSH_TIMEOUT_MS = 15_000;

/** One fix of today's trail, as read from the table. */
export interface TrailPoint {
  ts: Date;
  lat: number;
  lon: number;
  accuracyM: number | null;
  isHome: boolean | null;
  placeId: string | null;
}

export interface AppToday {
  /** "08:12", local time, or null if they have not left home today. */
  firstOut: string | null;
  /** Observed minutes away from home — gaps over ten minutes count nothing. */
  minutesOut: number;
  /** Metres moved, summed within continuous stretches only; an undercount by design. */
  distanceKm: number;
  /** Named places, in the order visited, consecutive repeats folded. */
  stops: string[];
  /** [lat, lon, epoch seconds], thinned to TRAIL_MAX_POINTS. */
  trail: [number, number, number][];
}

/**
 * Somebody on the move right now: how, and how fast. The phone names WHERE
 * from `position` (a reverse geocode on the device), so no street name is
 * computed or stored here.
 */
export interface AppMoving {
  /** The coarse speed band — `inferMode`'s, never stated as fact. */
  mode: 'walking' | 'active' | 'vehicle';
  speedKmh: number;
  /** The earliest fix of the moving stretch in the window, ISO. */
  since: string;
}

/** How far back "moving now" looks. */
export const MOVING_WINDOW_S = 10 * 60;
/** The newest fix must be at most this old, or it is where they WERE moving. */
export const MOVING_FRESH_S = 5 * 60;
/** Straight-line distance the window must cover: GPS wander at a desk is ~50 m. */
export const MOVING_MIN_DISPLACEMENT_M = 150;

export interface AppPerson {
  subject: string;
  name: string;
  /** This person is the viewer. */
  self: boolean;
  status: NowStatus;
  /** The /home/people card line: "At Elton Parade · seen 3m ago". */
  line: string;
  batteryPct: number | null;
  lastSeenAt: string | null;
  position: { lat: number; lon: number; at: string } | null;
  /** On the move now, or null. Everyone sharing gets it: it says no more
   *  than a pin that moves on every refresh already does. */
  moving: AppMoving | null;
  today: AppToday | null;
}

/** A one-time code that pairs this person's phone with the site. */
export interface SitePair {
  /** The site's public origin — where the phone redeems the code. */
  server: string;
  code: string;
  expiresAt: string;
}

export interface AppViewAccess extends AppAccess {
  /** Only for a member holding chat or news who asked in the last 15 minutes. */
  sitePair: SitePair | null;
}

export interface AppHouseholdView {
  generatedAt: string;
  /** 'none': someone on the app who may not see the household (no Family
   *  Circle, or no site access at all). They get no people — a household
   *  member among them also gets the places to watch. */
  viewer: 'owner' | 'household' | 'none';
  people: AppPerson[];
  /** Places whose leaving switches the phone to close tracking. */
  watch?: WatchedPlace[];
  /** What the app may offer this person beyond the family. */
  access: AppViewAccess;
}

/** A view before its `access` is attached — what the pure builder returns. */
export type AppPeopleView = Omit<AppHouseholdView, 'access'>;

/** A place the phone registers as a geofence (see `trackOnLeave`). */
export interface WatchedPlace {
  id: string;
  label: string;
  lat: number;
  lon: number;
  radiusM: number;
}

/** The places flagged for close tracking, home included unless switched off. */
export async function loadWatchedPlaces(): Promise<WatchedPlace[]> {
  const places = await listPanelPlaces();
  return places
    .filter((p) => p.trackOnLeave)
    .map((p) => ({ id: p.id, label: p.label ?? (p.isHome ? 'Home' : 'A place'), lat: p.lat, lon: p.lon, radiusM: p.radiusM }));
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

function clock(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: LOCAL_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
}

/** Every `step`th point and always the last, so the line ends where they are. PURE. */
export function thin<T>(points: readonly T[], max = TRAIL_MAX_POINTS): T[] {
  if (points.length <= max) return [...points];
  const step = Math.ceil(points.length / (max - 1));
  const out = points.filter((_, i) => i % step === 0);
  if (out.at(-1) !== points.at(-1)) out.push(points.at(-1) as T);
  return out;
}

/**
 * Today's figures from today's trail. PURE.
 *
 * A fix worse than MAX_USABLE_ACCURACY_M is left out entirely — a 500 m circle
 * draws a spike and adds a kilometre. A pair further apart than TRAIL_GAP_S
 * adds neither distance nor time: a phone that slept through a journey
 * undercounts, which is the honest direction. A pair implying an absurd speed
 * is a GPS jump and adds no distance.
 */
export function summariseTrail(
  points: readonly TrailPoint[],
  labels: ReadonlyMap<string, string | null>,
  firstOutAt: Date | null,
): AppToday {
  const usable = points.filter((p) => p.accuracyM == null || p.accuracyM <= MAX_USABLE_ACCURACY_M);
  let metres = 0;
  let secondsOut = 0;
  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1];
    const b = usable[i];
    const dt = (b.ts.getTime() - a.ts.getTime()) / 1000;
    if (dt <= 0 || dt > TRAIL_GAP_S) continue;
    if (a.isHome === false) secondsOut += dt;
    const d = distanceM(a.lat, a.lon, b.lat, b.lon);
    if ((d / dt) * 3.6 < ABSURD_SPEED_KMH) metres += d;
  }
  const stops: string[] = [];
  for (const p of usable) {
    const label = p.placeId ? labels.get(p.placeId) : null;
    if (label && stops.at(-1) !== label) stops.push(label);
  }
  return {
    firstOut: firstOutAt ? clock(firstOutAt) : null,
    minutesOut: Math.round(secondsOut / 60),
    distanceKm: Math.round(metres / 100) / 10,
    stops,
    trail: thin(usable).map((p) => [r5(p.lat), r5(p.lon), Math.round(p.ts.getTime() / 1000)]),
  };
}

/**
 * Whether the last few minutes of fixes are somebody moving. PURE.
 *
 * Moving means: the newest usable fix is fresh, the window's first and last
 * fixes are MOVING_MIN_DISPLACEMENT_M apart in a straight line (so pacing a
 * kitchen or GPS drift is still), and the average speed along the path is
 * past `still`. Speed is path distance over time, gaps and absurd jumps
 * excluded the way `summariseTrail` excludes them.
 */
export function movingFrom(points: readonly TrailPoint[], now: Date): AppMoving | null {
  const from = now.getTime() - MOVING_WINDOW_S * 1000;
  const usable = points.filter(
    (p) => p.ts.getTime() >= from && (p.accuracyM == null || p.accuracyM <= MAX_USABLE_ACCURACY_M),
  );
  if (usable.length < 2) return null;
  const first = usable[0];
  const last = usable[usable.length - 1];
  if (now.getTime() - last.ts.getTime() > MOVING_FRESH_S * 1000) return null;
  if (distanceM(first.lat, first.lon, last.lat, last.lon) < MOVING_MIN_DISPLACEMENT_M) return null;
  let metres = 0;
  let seconds = 0;
  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1];
    const b = usable[i];
    const dt = (b.ts.getTime() - a.ts.getTime()) / 1000;
    if (dt <= 0 || dt > TRAIL_GAP_S) continue;
    const d = distanceM(a.lat, a.lon, b.lat, b.lon);
    if ((d / dt) * 3.6 >= ABSURD_SPEED_KMH) continue;
    metres += d;
    seconds += dt;
  }
  if (seconds < 60) return null;
  const kmh = (metres / seconds) * 3.6;
  const mode = inferMode(kmh);
  if (mode !== 'walking' && mode !== 'active' && mode !== 'vehicle') return null;
  return { mode, speedKmh: Math.round(kmh), since: first.ts.toISOString() };
}

/** Whose trails a viewer's view carries: exactly the cards whose day they may see. PURE. */
export function trailSubjects(scoped: readonly ScopedPresence[]): string[] {
  return scoped.filter((m) => m.today != null && !m.notSharing).map((m) => m.subject);
}

/**
 * One viewer's view. PURE. `scoped` is `scopeHousehold`'s output for this
 * viewer, so nothing reaches a card here that the page would not show them.
 */
export function buildAppView(input: {
  viewer: PeopleViewer;
  /** The viewer's own subject, from their household row; null if they have none. */
  self: string | null;
  scoped: readonly ScopedPresence[];
  names: ReadonlyMap<string, string>;
  positions: readonly LivePosition[];
  trails: ReadonlyMap<string, readonly TrailPoint[]>;
  /** The last MOVING_WINDOW_S of fixes for everyone sharing, for `moving`. */
  recent?: ReadonlyMap<string, readonly TrailPoint[]>;
  labels: ReadonlyMap<string, string | null>;
  dayStart: Date;
  now: Date;
}): AppPeopleView {
  const { viewer, scoped, names, positions, trails, labels, dayStart, now } = input;
  const recent = input.recent ?? new Map<string, readonly TrailPoint[]>();
  const posBy = new Map(positions.map((p) => [p.subject, p]));
  const selfSubject = viewer.kind === 'household' ? viewer.subject : input.self;
  const people = scoped.map((m): AppPerson => {
    const pos = m.notSharing ? undefined : posBy.get(m.subject);
    const firstOutAt = m.today?.firstOutMins == null ? null : new Date(dayStart.getTime() + m.today.firstOutMins * 60_000);
    return {
      subject: m.subject,
      name: names.get(m.subject) ?? m.subject,
      self: m.subject === selfSubject,
      status: nowStatus(m),
      line: nowSub(m),
      batteryPct: m.notSharing ? null : m.batteryPct,
      lastSeenAt: m.notSharing || !m.lastSeenAt ? null : m.lastSeenAt.toISOString(),
      position: pos ? { lat: pos.lat, lon: pos.lon, at: pos.at } : null,
      moving: pos ? movingFrom(recent.get(m.subject) ?? [], now) : null,
      today: m.today != null && !m.notSharing ? summariseTrail(trails.get(m.subject) ?? [], labels, firstOutAt) : null,
    };
  });
  // Yourself first, then whoever was seen most recently: the order a glance wants.
  people.sort(
    (a, b) =>
      Number(b.self) - Number(a.self) ||
      Number(b.status !== 'off') - Number(a.status !== 'off') ||
      (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''),
  );
  return { generatedAt: now.toISOString(), viewer: viewer.kind, people };
}

function withWatch(view: AppPeopleView, watch: WatchedPlace[] | undefined): AppPeopleView {
  return watch ? { ...view, watch } : view;
}

/** How recent `sitePairWanted` must be for the push to answer it. */
export const SITE_PAIR_WANTED_MS = 15 * 60_000;
/** A cached code with less life than this left is replaced, not re-sent. */
export const SITE_PAIR_REUSE_FLOOR_MS = 2 * 60_000;

/**
 * Codes minted by this process, by email, so a push every 30 s re-sends the
 * code the phone may be halfway through redeeming instead of rotating it —
 * `createPairingCode` deletes the email's previous code, so a fresh one each
 * cycle would kill the one on the screen. Lost on restart, which costs one
 * rotation, and the phone simply picks up the new code on its next read.
 */
const sitePairCodes = new Map<string, { code: string; expiresAt: Date }>();

/** For tests: forget every cached code. */
export function resetSitePairCache(): void {
  sitePairCodes.clear();
}

/**
 * The site's public origin, where a phone redeems a code. There is no request
 * here to take `url.origin` from (the heartbeat has none), so it is the same
 * configured origin the rest of the server uses for links it sends out.
 */
export function siteOrigin(): string {
  const configured =
    process.env.PUBLIC_BASE_URL?.trim() || process.env.PUBLIC_SITE_URL?.trim() || process.env.ORIGIN?.trim();
  return (configured || 'https://strangeramblings.com').replace(/\/+$/, '');
}

/**
 * Did this person ask to pair with the site recently enough to answer? PURE.
 * A stamp from the future beyond a little clock skew is ignored rather than
 * read as a request that never goes stale.
 */
export function sitePairWanted(stamp: string | null | undefined, now: Date): boolean {
  if (!stamp) return false;
  const at = Date.parse(stamp);
  if (!Number.isFinite(at)) return false;
  const age = now.getTime() - at;
  return age <= SITE_PAIR_WANTED_MS && age >= -2 * 60_000;
}

/**
 * A pairing code for a MEMBER who holds chat or news and has asked, or null.
 *
 * Never for the owner: his phone pairs from /admin, behind his own session,
 * and a code of his travelling through the pilot would put an owner credential
 * one hop further from him than it needs to be. Never for anyone holding
 * neither area: they have nothing on the site to pair for. A mint that fails is
 * null — the rest of the push is worth more than one code.
 */
async function sitePairFor(
  email: string,
  access: AppAccess,
  wanted: string | null | undefined,
  now: Date,
): Promise<SitePair | null> {
  if (access.owner || !(access.chat || access.news) || !sitePairWanted(wanted, now)) {
    sitePairCodes.delete(email);
    return null;
  }
  try {
    let held = sitePairCodes.get(email);
    const reusable =
      !!held &&
      held.expiresAt.getTime() - now.getTime() > SITE_PAIR_REUSE_FLOOR_MS &&
      (await isPairingCodeLive(held.code));
    if (!held || !reusable) {
      held = await createPairingCode(email);
      sitePairCodes.set(email, held);
    }
    return { server: siteOrigin(), code: held.code, expiresAt: held.expiresAt.toISOString() };
  } catch (err) {
    console.error('[app-view] could not mint a site pairing code:', errMsg(err));
    return null;
  }
}

/** The trail since `dayStart` for these subjects, oldest first. */
async function loadTodayTrails(subjects: readonly string[], dayStart: Date): Promise<Map<string, TrailPoint[]>> {
  const out = new Map<string, TrailPoint[]>();
  if (subjects.length === 0) return out;
  const rows = await db
    .select({
      subject: daydreamTrail.subject,
      ts: daydreamTrail.ts,
      lat: daydreamTrail.lat,
      lon: daydreamTrail.lon,
      accuracyM: daydreamTrail.accuracyM,
      isHome: daydreamTrail.isHome,
      placeId: daydreamTrail.placeId,
    })
    .from(daydreamTrail)
    .where(
      and(
        inArray(daydreamTrail.subject, [...subjects]),
        gte(daydreamTrail.ts, dayStart),
        isNotNull(daydreamTrail.lat),
        isNotNull(daydreamTrail.lon),
      ),
    )
    .orderBy(asc(daydreamTrail.ts));
  for (const r of rows) {
    const list = out.get(r.subject) ?? [];
    list.push({ ts: r.ts, lat: Number(r.lat), lon: Number(r.lon), accuracyM: r.accuracyM, isHome: r.isHome, placeId: r.placeId });
    out.set(r.subject, list);
  }
  return out;
}

async function loadLabels(ids: readonly string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: daydreamPlaces.id, label: daydreamPlaces.label, status: daydreamPlaces.status })
    .from(daydreamPlaces)
    .where(inArray(daydreamPlaces.id, [...ids]));
  return activeLabels(rows);
}

export interface AppViewsResult {
  /** Views the pilot filed. */
  stored: number;
  /** People on the app who see nobody: not the owner, not in the Family Circle, or no household row. */
  refused: number;
  error?: string;
}

/**
 * Build a view for everyone on the app and hand the whole set to the pilot,
 * which REPLACES the family's views with it — somebody who stops qualifying
 * loses what their view showed on the next cycle. Everyone gets a view, since
 * it also carries `access`; someone who may not see the household gets one
 * with nobody in it. Null when no token is configured,
 * and null without a request when the pilot's users list cannot be read: an
 * empty push would wipe everybody's map over a read failure.
 */
export async function pushAppViews(
  members: readonly HouseholdMember[],
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<AppViewsResult | null> {
  const token = companionToken();
  if (!token) return null;
  const users: HouseholdUser[] | null = await loadCompanionUsers().catch(() => null);
  if (!users) return null;

  const viewers: Array<{ email: string; viewer: PeopleViewer }> = [];
  // Everyone else on the app gets a view with nobody in it. A household member
  // among them still gets the watched places: close tracking is about their
  // own phone. Anyone else gets no places — they are not the household's.
  const outside: Array<{ email: string; household: boolean }> = [];
  const accessBy = new Map<string, AppViewAccess>();
  const seen = new Set<string>();
  let refused = 0;
  const memberEmails = new Set(members.map((m) => m.email).filter((e): e is string => !!e));
  for (const u of users) {
    const email = String(u.email ?? '').trim().toLowerCase();
    if (!email) {
      refused++;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    const viewer = await peopleViewerForEmail(email);
    const { access } = await appAccessForEmail(email, viewer !== null);
    accessBy.set(email, { ...access, sitePair: await sitePairFor(email, access, u.sitePairWanted, now) });
    if (viewer) viewers.push({ email, viewer });
    else {
      refused++;
      outside.push({ email, household: memberEmails.has(email) });
    }
  }
  const watch = await loadWatchedPlaces().catch(() => undefined);
  const accessOf = (email: string) => accessBy.get(email) as AppViewAccess;

  const views: Array<{ email: string; view: AppHouseholdView }> = [];
  for (const { email, household } of outside) {
    const view: AppHouseholdView = { generatedAt: now.toISOString(), viewer: 'none', people: [], access: accessOf(email) };
    views.push({ email, view: household && watch ? { ...view, watch } : view });
  }
  if (viewers.length) {
    const dayStart = localDayStart(now);
    const [{ members: presence }, positions] = await Promise.all([loadHousehold(), livePositions().catch(() => [])]);
    const scopedBy = viewers.map((v) => ({ ...v, scoped: scopeHousehold(presence, v.viewer) }));
    const wanted = [...new Set(scopedBy.flatMap((v) => trailSubjects(v.scoped)))];
    const trails = await loadTodayTrails(wanted, dayStart);
    // Everyone with a pin, whoever may see their day: moving-or-not is a
    // property of the live position, not of the day's history.
    const recent = await loadTodayTrails(
      positions.map((p) => p.subject),
      new Date(now.getTime() - MOVING_WINDOW_S * 1000),
    ).catch(() => new Map<string, TrailPoint[]>());
    const placeIds = [...new Set([...trails.values()].flat().map((p) => p.placeId).filter((x): x is string => !!x))];
    const labels = await loadLabels(placeIds);
    const names = new Map(members.map((m) => [m.subject, m.displayName]));
    for (const v of scopedBy) {
      views.push({
        email: v.email,
        view: {
          ...withWatch(buildAppView({
          viewer: v.viewer,
          self: members.find((m) => m.email === v.email)?.subject ?? null,
          scoped: v.scoped,
          names,
          positions,
          trails,
          recent,
          labels,
          dayStart,
          now,
        }), watch),
          access: accessOf(v.email),
        },
      });
    }
  }

  try {
    const res = await fetchImpl(`${companionUrl()}/api/apple/household/views`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ views }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    if (!res.ok) return { stored: 0, refused, error: `views answered ${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { stored?: unknown };
    return { stored: typeof body.stored === 'number' ? body.stored : 0, refused };
  } catch (err) {
    return { stored: 0, refused, error: errMsg(err) };
  }
}
