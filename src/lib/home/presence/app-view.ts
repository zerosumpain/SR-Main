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

import { and, asc, gte, inArray, isNotNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail } from '$lib/db/schema';
import { companionToken, companionUrl, loadCompanionUsers, type HouseholdUser } from './companion';
import { distanceM } from './geo';
import { livePositions, loadHousehold, type LivePosition } from './household';
import type { HouseholdMember } from './members';
import { nowStatus, nowSub, type NowStatus } from './now';
import { ABSURD_SPEED_KMH, LOCAL_TZ, MAX_USABLE_ACCURACY_M, activeLabels, errMsg, localDayStart } from './types';
import { peopleViewerForEmail, scopeHousehold, type PeopleViewer, type ScopedPresence } from './viewer';

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
  today: AppToday | null;
}

export interface AppHouseholdView {
  generatedAt: string;
  viewer: 'owner' | 'household';
  people: AppPerson[];
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
  labels: ReadonlyMap<string, string | null>;
  dayStart: Date;
  now: Date;
}): AppHouseholdView {
  const { viewer, scoped, names, positions, trails, labels, dayStart, now } = input;
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

/** Today's trail for these subjects, oldest first. */
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
  /** People on the app who got no view: not the owner, not in the Family Circle, or no household row. */
  refused: number;
  error?: string;
}

/**
 * Build a view for everyone on the app and hand the whole set to the pilot,
 * which REPLACES the family's views with it — somebody who stops qualifying
 * loses the view they had on the next cycle. Null when no token is configured,
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
  let refused = 0;
  for (const u of users) {
    const email = String(u.email ?? '').trim().toLowerCase();
    const viewer = email ? await peopleViewerForEmail(email) : null;
    if (viewer) viewers.push({ email, viewer });
    else refused++;
  }

  const views: Array<{ email: string; view: AppHouseholdView }> = [];
  if (viewers.length) {
    const dayStart = localDayStart(now);
    const [{ members: presence }, positions] = await Promise.all([loadHousehold(), livePositions().catch(() => [])]);
    const scopedBy = viewers.map((v) => ({ ...v, scoped: scopeHousehold(presence, v.viewer) }));
    const wanted = [...new Set(scopedBy.flatMap((v) => trailSubjects(v.scoped)))];
    const trails = await loadTodayTrails(wanted, dayStart);
    const placeIds = [...new Set([...trails.values()].flat().map((p) => p.placeId).filter((x): x is string => !!x))];
    const labels = await loadLabels(placeIds);
    const names = new Map(members.map((m) => [m.subject, m.displayName]));
    for (const v of scopedBy) {
      views.push({
        email: v.email,
        view: buildAppView({
          viewer: v.viewer,
          self: members.find((m) => m.email === v.email)?.subject ?? null,
          scoped: v.scoped,
          names,
          positions,
          trails,
          labels,
          dayStart,
          now,
        }),
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
