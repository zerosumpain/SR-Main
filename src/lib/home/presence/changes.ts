// src/lib/home/presence/changes.ts
//
// What changed: the family's movements this fortnight set against the weeks
// before — someone leaving later, a journey getting slower, a routine that
// has started or stopped, more walking and less driving. PURE, from the same
// learned routes and routines as the forecast (`forecast.ts`), so a change
// named here is one the forecast itself will follow.
//
// Every rule needs evidence on both sides of the line (RECENT_DAYS ago): a
// handful of runs before and after, and a difference big enough to notice.
// A thin fortnight is silence, never a change.

import { circularMedianMinute, hhmm } from './stats';
import {
  clockDeltaMinutes, holidayOn, localClock, NO_SCHOOL_CALENDAR, OVERDUE_MIN_SHARE, predictionBand, ROUTINE_WINDOW_MINS,
  routinesOf, runsOn, type Routine, type SchoolCalendar,
} from './forecast';
import { cleanDurations, percentile, type PresenceInsights, type RouteInsight } from './insights';

const DAY = 86_400_000;

/** The "recent" side of every comparison. */
export const RECENT_DAYS = 14;
/** A routine is new when its first run was this recent: four weeks, so a weekly one has had three. */
export const NEW_WITHIN_DAYS = 28;
/** Runs needed on each side before two medians are compared. */
export const CHANGE_MIN_RUNS = 3;
/** A departure has moved when its median moves at least this far. */
export const DRIFT_MINS = 10;
/** A journey has changed when its median moves by this many minutes and this share. */
export const SLOWER_MINS = 3;
export const SLOWER_SHARE = 0.2;
/** Trips each side, and points of share, before a change of travel mode is named. */
export const MODE_MIN_TRIPS = 8;
export const MODE_SHIFT = 0.2;

export type ChangeKind = 'later' | 'earlier' | 'slower' | 'quicker' | 'new-routine' | 'faded' | 'more-active' | 'less-active';

export interface Change {
  /** Stable for the change, so a digest can say it once. */
  key: string;
  kind: ChangeKind;
  subject: string;
  person: string;
  title: string;
  detail: string;
  /** Bigger is more worth reading; changes are listed by it. */
  weight: number;
}

const round = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dayWords = (r: Routine) => {
  const names = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
  if (r.weekdays?.length) return r.weekdays.map((w) => names[w]).join(' and ');
  return r.dayType === 'weekday' ? 'weekdays' : 'weekends';
};

/** The runs of a routine on its route: its day type, near its time. */
function runsOf(r: Routine, route: RouteInsight | undefined): Array<{ at: number; minute: number }> {
  return (route?.trips ?? [])
    .filter((t) => !t.broken)
    .map((t) => ({ at: Date.parse(t.start), clock: localClock(Date.parse(t.start)) }))
    .filter(({ clock }) => runsOn(r, clock) && Math.abs(clockDeltaMinutes(clock.minute, r.departureMin)) <= ROUTINE_WINDOW_MINS)
    .map(({ at, clock }) => ({ at, minute: clock.minute }));
}

/**
 * Everything that changed for the people in `insights`. PURE.
 *
 * `trackedSince` is when each person's current tracker began (the day they
 * moved from Life360 to the app). Trips before it are left out: the two see a
 * departure at different moments, and the switch itself read as "the school
 * run is 5 min slower" on the family's real data (2026-10-25).
 */
export function whatChanged(
  insights: PresenceInsights, now: Date, cal: SchoolCalendar = NO_SCHOOL_CALENDAR, trackedSince: ReadonlyMap<string, number> = new Map(),
): Change[] {
  const line = +now - RECENT_DAYS * DAY;
  // Whether a routine exists does not depend on the tracker (the school run
  // ran under Life360 too): starting and stopping read the whole history.
  const allRoutines = routinesOf(insights.routes, now, insights.days, cal);
  const before = routinesOf(insights.routes.map((r) => ({ ...r, trips: r.trips.filter((t) => Date.parse(t.start) < line) })), new Date(line), insights.days - RECENT_DAYS, cal);
  // Timings and modes compare only trips seen by the current tracker.
  const whole = insights;
  insights = {
    ...insights,
    routes: insights.routes.map((r) => ({ ...r, trips: r.trips.filter((t) => Date.parse(t.start) >= (trackedSince.get(r.subject) ?? 0)) })),
  };
  const routines = routinesOf(insights.routes, now, insights.days, cal);
  const out: Change[] = [];

  // ── Departures drifting ────────────────────────────────────────────────
  for (const r of routines) {
    if (r.days / r.of < OVERDUE_MIN_SHARE) continue;
    const runs = runsOf(r, insights.routes.find((x) => x.id === r.routeId));
    const recent = runs.filter((x) => x.at >= line), earlier = runs.filter((x) => x.at < line);
    if (recent.length < CHANGE_MIN_RUNS || earlier.length < CHANGE_MIN_RUNS) continue;
    const now_ = circularMedianMinute(recent.map((x) => x.minute)), was = circularMedianMinute(earlier.map((x) => x.minute));
    const delta = Math.round(clockDeltaMinutes(now_, was));
    if (Math.abs(delta) < DRIFT_MINS) continue;
    const kind: ChangeKind = delta > 0 ? 'later' : 'earlier';
    out.push({
      key: `${kind}:${r.id}`, kind, subject: r.subject, person: r.person,
      title: `${r.person} leaves for ${r.to} ${Math.abs(delta)} min ${kind}`,
      detail: `${hhmm(now_)} on ${dayWords(r)} over the last ${RECENT_DAYS} days (${plural(recent.length, 'run')}); it was ${hhmm(was)} (${plural(earlier.length, 'run')}).`,
      weight: Math.abs(delta) / DRIFT_MINS,
    });
  }

  // ── Journeys getting slower or quicker ─────────────────────────────────
  for (const route of insights.routes) {
    const clean = route.trips.filter((t) => !t.broken);
    const recent = clean.filter((t) => Date.parse(t.start) >= line).map((t) => t.minutes);
    const earlier = clean.filter((t) => Date.parse(t.start) < line).map((t) => t.minutes);
    if (recent.length < CHANGE_MIN_RUNS || earlier.length < CHANGE_MIN_RUNS) continue;
    const a = percentile(cleanDurations(recent).clean, 0.5), b = percentile(cleanDurations(earlier).clean, 0.5);
    const delta = a - b;
    if (Math.abs(delta) < SLOWER_MINS || Math.abs(delta) < b * SLOWER_SHARE) continue;
    // Outside where the earlier trips said the next one would land: a route
    // that always varied this much (a wander into town) has not changed.
    const band = predictionBand(cleanDurations(earlier).clean);
    if (a >= band.low && a <= band.high) continue;
    const kind: ChangeKind = delta > 0 ? 'slower' : 'quicker';
    out.push({
      key: `${kind}:${route.id}`, kind, subject: route.subject, person: route.person,
      title: `${route.person}'s ${route.from} → ${route.to} is ${Math.round(Math.abs(delta))} min ${kind}`,
      detail: `${round(a)} min typical over the last ${RECENT_DAYS} days (${plural(recent.length, 'trip')}); it was ${round(b)} min (${plural(earlier.length, 'trip')}).`,
      weight: Math.abs(delta) / SLOWER_MINS,
    });
  }

  // ── Routines starting and stopping ─────────────────────────────────────
  const newLine = +now - NEW_WITHIN_DAYS * DAY;
  // New only against a history: for someone tracked a fortnight, everything is.
  const seenBefore = new Set(whole.routes.filter((r) => r.trips.some((t) => Date.parse(t.start) < newLine)).map((r) => r.subject));
  for (const r of allRoutines) {
    const first = Math.min(...r.dates.map((d) => Date.parse(`${d}T12:00:00Z`)));
    if (first < newLine || r.days < CHANGE_MIN_RUNS || !seenBefore.has(r.subject)) continue;
    out.push({
      key: `new-routine:${r.id}`, kind: 'new-routine', subject: r.subject, person: r.person,
      title: `New: ${r.person} to ${r.to} on ${dayWords(r)}`,
      detail: `${plural(r.days, 'time')} since ${r.dates.slice().sort()[0]}, leaving about ${r.departure}.`,
      weight: r.days / CHANGE_MIN_RUNS,
    });
  }
  for (const b of before) {
    if (b.days / b.of < OVERDUE_MIN_SHARE || b.days < 5) continue;
    if (allRoutines.some((r) => r.id === b.id && r.dates.some((d) => Date.parse(`${d}T12:00:00Z`) >= line))) continue;
    // Days it could have run since the line, holidays aside.
    let could = 0;
    for (let t = line; t < +now; t += DAY) {
      const c = localClock(t);
      if (runsOn(b, c) && !(holidayOn(cal, c.date) && (cal.schoolIds.has(b.fromId) || cal.schoolIds.has(b.toId)))) could++;
    }
    if (could < CHANGE_MIN_RUNS) continue;
    const last = b.dates.slice().sort().at(-1)!;
    out.push({
      key: `faded:${b.id}:${last}`, kind: 'faded', subject: b.subject, person: b.person,
      title: `${b.person} hasn't been to ${b.to} on ${dayWords(b)} since ${last}`,
      detail: `Before then it ran on ${b.days} of ${b.of} days it could, around ${b.departure}; none of the ${could} since.`,
      weight: b.days / 5,
    });
  }

  // ── Walking and driving ────────────────────────────────────────────────
  for (const p of insights.people) {
    const trips = insights.routes.filter((r) => r.subject === p.subject)
      .flatMap((r) => r.trips.filter((t) => !t.broken).map((t) => ({ at: Date.parse(t.start), active: r.mode !== 'vehicle' })));
    const recent = trips.filter((t) => t.at >= line), earlier = trips.filter((t) => t.at < line);
    if (recent.length < MODE_MIN_TRIPS || earlier.length < MODE_MIN_TRIPS) continue;
    const a = recent.filter((t) => t.active).length / recent.length, b = earlier.filter((t) => t.active).length / earlier.length;
    if (Math.abs(a - b) < MODE_SHIFT) continue;
    const kind: ChangeKind = a > b ? 'more-active' : 'less-active';
    out.push({
      key: `${kind}:${p.subject}`, kind, subject: p.subject, person: p.displayName,
      title: `${p.displayName} is ${kind === 'more-active' ? 'walking or cycling more' : 'driving more'}`,
      detail: `${Math.round(a * 100)}% of trips on foot or by bike over the last ${RECENT_DAYS} days (${plural(recent.length, 'trip')}); it was ${Math.round(b * 100)}%.`,
      weight: Math.abs(a - b) / MODE_SHIFT,
    });
  }

  return out.sort((x, y) => y.weight - x.weight);
}
