// src/lib/home/presence/parent-alerts.ts
//
// What a parent's phone is told about a child, from the forecast's one
// computation (`forecast.server`). PURE; delivery is ./parent-alerts.server.
//
// Two kinds (John, 2026-11-01):
//
// - `stopped`: a child finished a journey or paused on one. The trip engine
//   (`extractTrips`) already decides that — ten still minutes at a place ends a
//   trip there, and an unknown spot becomes a place on the same run
//   (`discoverRecentStops`) — so every completed trip is a stop: "Rory stopped
//   at School". An ordinary push.
// - `school-late`: a school routine that runs today has passed its usual latest
//   arrival by LATE_TOLERANCE_MINS and the child is not there. TIME-SENSITIVE:
//   it is the one that must get through a Focus.
//
// Only children are announced, only to their guardians (`guardianOf`).

import type { PushMessage } from '$lib/server/apns';
import type { HouseholdMember } from './members';
import type { InsightPlace, LiveState, RouteInsight } from './insights';
import { ownPlaceName, placeTitle } from './insights';
import { metresBetween } from './cluster';
import {
  clockDeltaMinutes,
  correctedShare,
  localClock,
  offForHoliday,
  OVERDUE_MIN_SHARE,
  runsOn,
  type ForecastCorrection,
  type Routine,
  type SchoolCalendar,
} from './forecast';

const MINUTE = 60_000;

/** A stop is told while it is this fresh; older (a deploy, a quiet phone catching up) is history. */
export const STOP_WINDOW_MINS = 45;
/** Minutes past a school routine's usual latest arrival before a parent is told. */
export const LATE_TOLERANCE_MINS = 15;
/** Past this many minutes late it is a day off nobody entered, not news. */
export const LATE_GIVE_UP_MINS = 120;
/**
 * Last seen further than this from the school: not on a school run at all — a
 * holiday nobody entered. Half-term 2026 in Rome raised twelve "isn't at
 * school" in a replay without it.
 */
export const FAR_AWAY_KM = 30;

export interface ParentNotice {
  /** Stable across runs: the dedupe key. */
  id: string;
  kind: 'stopped' | 'school-late';
  subject: string;
  /** Lower-cased guardian emails. */
  recipients: string[];
  push: PushMessage;
  /** Until when it is still worth sending. */
  until: number;
  /** The name the OWNER gave the place, when he gave one: what the
   *  `family.alert` event says. Never a looked-up label (`ownPlaceName`). */
  place?: string;
  /** The event's title, worded round `place` alone. The push title may name a
   *  looked-up label for the family's phones; this one never does. */
  eventTitle: string;
}

/** Each child's guardians' emails: the members whose `guardianOf` names them. PURE. */
export function guardiansByChild(members: readonly HouseholdMember[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const g of members) {
    const email = g.email?.trim().toLowerCase();
    if (!email) continue;
    for (const child of g.guardianOf ?? []) {
      if (child === g.subject) continue;
      const list = out.get(child) ?? [];
      if (!list.includes(email)) list.push(email);
      out.set(child, list);
    }
  }
  return out;
}

const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const clock = (t: number) => clockFmt.format(new Date(t));
const hhmm = (minuteOfDay: number) => {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function base(kind: ParentNotice['kind'], id: string, subject: string) {
  return {
    category: 'household',
    threadId: 'household',
    collapseId: id.slice(0, 64),
    userInfo: { id, category: 'household', kind, url: `/home/people?person=${encodeURIComponent(subject)}` },
  } satisfies Partial<PushMessage>;
}

/** An arrival crossing that was pushed, and to whom (lower-cased emails). */
export interface ArrivalPushed {
  subject: string;
  placeId: string;
  /** ms */
  at: number;
  to: readonly string[];
}

/** How long after a trip's computed end its arrival crossing may fall: the
 *  crossing fires on the first fix inside the place, the trip ends on the
 *  dwell, and the two can sit a few minutes apart. */
export const ARRIVAL_MATCH_MINS = 20;

/** Whoever an arrival push for this trip already reached. PURE. */
export function arrivalTold(
  arrivals: readonly ArrivalPushed[],
  subject: string,
  placeId: string,
  left: number,
  arrived: number,
): string[] {
  return arrivals
    .filter((a) => a.subject === subject && a.placeId === placeId && a.at >= left && a.at <= arrived + ARRIVAL_MATCH_MINS * MINUTE)
    .flatMap((a) => a.to.map((r) => r.trim().toLowerCase()));
}

/** Every trip a child completed in the last STOP_WINDOW_MINS, as a notice for their guardians. PURE. */
export function stopNotices(input: {
  routes: readonly RouteInsight[];
  places: readonly InsightPlace[];
  guardians: ReadonlyMap<string, string[]>;
  names: ReadonlyMap<string, string>;
  now: Date;
  /** Trips (`<subject>-<arrived ms>`) an "arrived safely" already tells
   *  these recipients about (`journey-alerts`): they are not told twice. */
  covered?: ReadonlyMap<string, readonly string[]>;
  /** Arrival pushes already sent (`household_event` arrive rows and who they
   *  reached). A guardian pushed "arrived at School" for the trip is not also
   *  told "stopped at School" ten minutes later (review 2026-11-09). */
  arrivals?: readonly ArrivalPushed[];
}): ParentNotice[] {
  const { routes, places, guardians, names, now } = input;
  const out: ParentNotice[] = [];
  for (const route of routes) {
    if (!guardians.get(route.subject)?.length) continue;
    for (const trip of route.trips) {
      const left = +new Date(trip.start), arrived = left + trip.minutes * MINUTE;
      if (arrived > +now || +now - arrived > STOP_WINDOW_MINS * MINUTE) continue;
      const told = [
        ...(input.covered?.get(`${route.subject}-${arrived}`) ?? []),
        ...arrivalTold(input.arrivals ?? [], route.subject, route.toId, left, arrived),
      ];
      const recipients = guardians.get(route.subject)!.filter((r) => !told.includes(r));
      if (!recipients.length) continue;
      const to = places.find((p) => p.id === route.toId);
      const where = to?.label || to?.suggestedLabel || (to?.kind === 'home' ? 'Home' : null);
      const named = ownPlaceName(to);
      const name = names.get(route.subject) ?? route.person;
      const id = `stop-${route.subject}-${arrived}`;
      out.push({
        id, kind: 'stopped', subject: route.subject, recipients, until: arrived + STOP_WINDOW_MINS * MINUTE,
        ...(named ? { place: named } : {}),
        eventTitle: named ? `${name} stopped at ${named}` : `${name} stopped somewhere`,
        push: {
          ...base('stopped', id, route.subject),
          title: where ? `${name} stopped at ${where}` : `${name} stopped somewhere new`,
          body: `Since ${clock(arrived)}, ${Math.round(trip.minutes)} min after leaving ${route.from}.`
            + (where ? '' : ' Not a place they have been before; open the map to see where.'),
          level: 'active',
          ttlSeconds: STOP_WINDOW_MINS * 60,
        },
      });
    }
  }
  return out;
}

/**
 * A child not at school well after they usually get there, on a day their
 * school routine runs. Needs a dependable routine (OVERDUE_MIN_SHARE of its
 * days), not a holiday, not corrected for today, and no arrival there today. PURE.
 */
export function schoolLateNotices(input: {
  routines: readonly Routine[];
  live: readonly LiveState[];
  places: readonly InsightPlace[];
  guardians: ReadonlyMap<string, string[]>;
  names: ReadonlyMap<string, string>;
  cal: SchoolCalendar;
  now: Date;
  corrections?: readonly ForecastCorrection[];
  /** Each child's last known position, however old. */
  positions?: ReadonlyMap<string, { lat: number; lon: number }>;
}): ParentNotice[] {
  const { routines, live, places, guardians, names, cal, now } = input;
  const corrections = input.corrections ?? [];
  const today = localClock(now);
  // One routine per child and school: the one they keep to most.
  const best = new Map<string, Routine>();
  for (const r of routines) {
    if (!cal.schoolIds.has(r.toId) || !guardians.get(r.subject)?.length) continue;
    if (!runsOn(r, today) || offForHoliday(r, cal, today.date) || correctedShare(r, corrections) < OVERDUE_MIN_SHARE) continue;
    if (corrections.some((c) => c.kind === 'routine' && c.routineId === r.id && c.date === today.date)) continue;
    const key = `${r.subject}|${r.toId}`, held = best.get(key);
    if (!held || correctedShare(r, corrections) > correctedShare(held, corrections)) best.set(key, r);
  }
  const out: ParentNotice[] = [];
  for (const r of best.values()) {
    // Got there today by any route (a lift from somewhere else counts), or there now.
    const arrivedToday = routines.some((o) => o.subject === r.subject && o.toId === r.toId && o.dates.includes(today.date));
    const state = live.find((s) => s.subject === r.subject);
    if (arrivedToday || state?.placeId === r.toId) continue;
    const school = places.find((p) => p.id === r.toId), pos = input.positions?.get(r.subject);
    if (school && pos && metresBetween(pos.lat, pos.lon, school.lat, school.lon) > FAR_AWAY_KM * 1000) continue;
    const latest = r.window[1] + r.minutes.p80;
    const late = clockDeltaMinutes(today.minute, latest);
    if (late < LATE_TOLERANCE_MINS || late > LATE_GIVE_UP_MINS) continue;
    const name = names.get(r.subject) ?? r.person;
    const schoolName = placeTitle(school), schoolNamed = ownPlaceName(school);
    const id = `late-${r.subject}-${r.toId}-${today.date}`;
    const seen = state?.lastSeen ? +new Date(state.lastSeen) : null;
    const quiet = seen == null || +now - seen > 30 * MINUTE;
    const at = state?.placeId ? placeTitle(places.find((p) => p.id === state.placeId)) : null;
    const lastly = seen == null
      ? 'No location from their phone today.'
      : quiet
        ? `No location since ${clock(seen)}${at ? ` (${at})` : ''}: a flat battery or no signal reads the same.`
        : state?.moving ? `On the move at ${clock(seen)}.` : `At ${at ?? 'an unnamed place'} at ${clock(seen)}.`;
    out.push({
      id, kind: 'school-late', subject: r.subject, recipients: guardians.get(r.subject)!,
      ...(schoolNamed ? { place: schoolNamed } : {}),
      eventTitle: `${name} isn't at ${schoolNamed ?? 'school'} yet`,
      until: +now + (LATE_GIVE_UP_MINS - late) * MINUTE,
      push: {
        ...base('school-late', id, r.subject),
        title: `${name} isn't at ${schoolName} yet`,
        body: `Usually there by ${hhmm(latest)} (${r.days} of ${r.of} ${r.dayType}s). ${lastly}`,
        level: 'time-sensitive',
        relevance: 1,
        ttlSeconds: 30 * 60,
      },
    });
  }
  return out;
}
