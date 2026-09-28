// src/lib/home/presence/forecast.ts
//
// The family forecast: what each person usually does next, what looks off
// right now, and how long a journey will take — read from the learned routes
// (`insights.ts`), never from a model. PURE: every function takes its clock
// and its inputs, so the page, the heartbeat's notifier and (later) the app's
// native lane all compute the same answer from the same data.
//
// The shape here is the contract the SR app will read. Every estimate carries
// where it came from (`source`) and how much evidence it stands on, because a
// travel time the family acts on must say whether it is "your last 11 school
// runs" or "a router's guess for somewhere nobody has been".

import { circularMedianMinute, hhmm } from './stats';
import { cleanDurations, percentile, type ArrivalInsight, type LiveState, type PresenceInsights, type RouteInsight } from './insights';
import { LOCAL_TZ } from './types';

const MINUTE = 60_000;

// ── Local clock ─────────────────────────────────────────────────────────────

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: LOCAL_TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Local weekday (0 = Monday), date and minute of day for an instant. PURE. */
export function localClock(at: number | Date): { weekday: number; date: string; minute: number } {
  const p = partsFmt.formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return {
    weekday: WEEKDAYS.indexOf(get('weekday') as (typeof WEEKDAYS)[number]),
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minute: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
}

export type DayType = 'weekday' | 'weekend';
export const dayTypeOf = (weekday: number): DayType => (weekday >= 5 ? 'weekend' : 'weekday');

/** The instant a local minute of the day `now` falls on occurs. */
function atLocalMinute(now: number, minute: number): number {
  return now + (minute - localClock(now).minute) * MINUTE - (now % MINUTE);
}

/** Signed distance between two clock minutes, the short way round. */
const clockDelta = (a: number, b: number) => ((a - b + 720 + 1440) % 1440) - 720;

// ── Routines ────────────────────────────────────────────────────────────────

/** How close a trip's departure must be to a routine's usual time to be one of its runs. */
export const ROUTINE_WINDOW_MINS = 75;
/** Fewest runs before a departure pattern is called a routine. */
export const ROUTINE_MIN_RUNS = 3;

/**
 * A route someone takes at a regular time: "Home → School, weekdays, leaves
 * 08:24". One route can hold two routines (a weekday one and a weekend one);
 * trips at odd times belong to the route but to no routine.
 */
export interface Routine {
  id: string;
  routeId: string;
  subject: string;
  person: string;
  fromId: string;
  toId: string;
  from: string;
  to: string;
  mode: string;
  dayType: DayType;
  /** Usual departure, local HH:MM, and the minute of day it is. */
  departure: string;
  departureMin: number;
  /** Where 80% of departures fall, as minutes of day. */
  window: [number, number];
  /** Distinct local days the routine ran, and days of that type in the window. */
  days: number;
  of: number;
  /** Journey minutes over the routine's clean runs. */
  minutes: { median: number; low: number; high: number; p80: number };
  /** Local dates it ran, for "has it happened today". */
  dates: string[];
}

/** Days of each type in a window ending at `now`. */
function dayTypeCounts(now: number, days: number): Record<DayType, number> {
  const out: Record<DayType, number> = { weekday: 0, weekend: 0 };
  for (let i = 0; i < days; i++) out[dayTypeOf(localClock(now - i * 86_400_000).weekday)]++;
  return out;
}

/** Routines out of the learned routes. PURE. */
export function routinesOf(routes: RouteInsight[], now: Date, days: number): Routine[] {
  const out: Routine[] = [];
  for (const r of routes) {
    for (const dayType of ['weekday', 'weekend'] as const) {
      const runs = r.trips
        .filter((t) => !t.broken)
        .map((t) => ({ ...t, clock: localClock(new Date(t.start)) }))
        .filter((t) => dayTypeOf(t.clock.weekday) === dayType);
      if (runs.length < ROUTINE_MIN_RUNS) continue;
      const centre = circularMedianMinute(runs.map((t) => t.clock.minute));
      const slot = runs.filter((t) => Math.abs(clockDelta(t.clock.minute, centre)) <= ROUTINE_WINDOW_MINS);
      if (slot.length < ROUTINE_MIN_RUNS) continue;
      const offsets = slot.map((t) => clockDelta(t.clock.minute, centre));
      const minutes = cleanDurations(slot.map((t) => t.minutes)).clean;
      const dates = [...new Set(slot.map((t) => t.clock.date))];
      const median = circularMedianMinute(slot.map((t) => t.clock.minute));
      // Counted from the first run, not the window's start: a school term that
      // began three weeks into a 28-day window has not been missed on the
      // holiday days before it.
      const first = Math.min(...slot.map((t) => +new Date(t.start)));
      const since = Math.min(days, Math.ceil((+now - first) / 86_400_000));
      out.push({
        id: `${r.id}:${dayType}`,
        routeId: r.id,
        subject: r.subject,
        person: r.person,
        fromId: r.fromId,
        toId: r.toId,
        from: r.from,
        to: r.to,
        mode: r.mode,
        dayType,
        departure: hhmm(median),
        departureMin: Math.round(median),
        window: [
          Math.round(centre + percentile(offsets, 0.1) + 1440) % 1440,
          Math.round(centre + percentile(offsets, 0.9) + 1440) % 1440,
        ],
        days: dates.length,
        of: Math.max(dates.length, dayTypeCounts(+now, since)[dayType]),
        minutes: {
          median: round(percentile(minutes, 0.5)),
          low: round(percentile(minutes, 0.1)),
          high: round(percentile(minutes, 0.9)),
          p80: round(percentile(minutes, 0.8)),
        },
        dates,
      });
    }
  }
  return out.sort((a, b) => b.days - a.days);
}

const round = (n: number) => Math.round(n * 10) / 10;

/** "9 of 20 weekdays" — how often the routine ran on days it could have. */
export const routineShare = (r: Routine) => (r.of ? r.days / r.of : 0);

// ── Travel time ─────────────────────────────────────────────────────────────

/**
 * Where a travel time came from, most trusted first. `person` is this
 * person's own trips; `household` is anyone's trips between the same two
 * places; `routed` is a router's time for a pair nobody has travelled.
 */
export type EstimateSource = 'person' | 'household' | 'routed';

export interface TravelEstimate {
  source: EstimateSource;
  median: number;
  low: number;
  high: number;
  /** The margin a leave-by time is set against: four trips in five arrive inside it. */
  p80: number;
  samples: number;
  /** Whose trips, for "from Katie's trips". */
  basis: string | null;
  mode: string;
}

/**
 * The learned journey time from one place to another, for this person first
 * and then for anyone in the household. Null when nobody has made the trip
 * three times — the caller routes it, or says it cannot tell. PURE.
 */
export function learnedTravel(routes: RouteInsight[], fromId: string, toId: string, subject: string | null): TravelEstimate | null {
  const pair = routes.filter((r) => r.fromId === fromId && r.toId === toId);
  const pick = (list: RouteInsight[], source: EstimateSource): TravelEstimate | null => {
    const trips = list.flatMap((r) => r.trips.filter((t) => !t.broken).map((t) => t.minutes));
    if (trips.length < ROUTINE_MIN_RUNS) return null;
    const clean = cleanDurations(trips).clean;
    const main = [...list].sort((a, b) => b.samples - a.samples)[0];
    return {
      source,
      median: round(percentile(clean, 0.5)),
      low: round(percentile(clean, 0.1)),
      high: round(percentile(clean, 0.9)),
      p80: round(percentile(clean, 0.8)),
      samples: clean.length,
      basis: source === 'household' ? [...new Set(list.map((r) => r.person))].join(', ') : main.person,
      mode: main.mode,
    };
  };
  return (subject ? pick(pair.filter((r) => r.subject === subject), 'person') : null) ?? pick(pair, 'household');
}

// ── Next move ───────────────────────────────────────────────────────────────

/** How far ahead "next" looks. */
export const NEXT_HORIZON_MINS = 6 * 60;
/** A routine is offered as "usually" only above this share of its days. */
export const NEXT_MIN_SHARE = 0.35;

export interface NextMove {
  subject: string;
  kind: 'routine' | 'arriving';
  routineId: string | null;
  from: string;
  to: string;
  /** When they usually leave (routine) or were seen leaving (arriving). */
  leaveAt: string;
  /** Arrival window. */
  arriveFrom: string;
  arriveTo: string;
  days: number;
  of: number;
  dayType: DayType | null;
  confidence: 'established' | 'emerging';
}

function ranToday(r: Routine, today: string): boolean {
  return r.dates.includes(today);
}

/**
 * Each person's next likely move. A live arrival estimate wins; otherwise
 * the soonest routine that leaves from where they are now, later today, and
 * has not already run today. Nothing is offered for someone whose place is
 * unknown — a routine from "home" says nothing about a person who is not
 * there. PURE.
 */
export function nextMoves(routines: Routine[], live: LiveState[], arrivals: ArrivalInsight[], now: Date): NextMove[] {
  const clock = localClock(now), dayType = dayTypeOf(clock.weekday);
  const out: NextMove[] = [];
  for (const state of live) {
    const arrival = arrivals.find((a) => a.subject === state.subject);
    if (arrival) {
      out.push({
        subject: state.subject, kind: 'arriving', routineId: null, from: arrival.from, to: arrival.to,
        leaveAt: arrival.departedAt, arriveFrom: arrival.earliest, arriveTo: arrival.latest,
        days: arrival.samples, of: arrival.samples, dayType: null, confidence: arrival.confidence,
      });
      continue;
    }
    if (!state.placeId || state.moving) continue;
    const candidates = routines
      .filter((r) => r.subject === state.subject && r.fromId === state.placeId && r.dayType === dayType)
      .filter((r) => routineShare(r) >= NEXT_MIN_SHARE && !ranToday(r, clock.date))
      .map((r) => ({ r, ahead: clockDelta(r.departureMin, clock.minute) }))
      // Still due: up to the end of its window (a late start is still next).
      .filter(({ r, ahead }) => ahead <= NEXT_HORIZON_MINS && clockDelta(r.window[1], clock.minute) >= -15)
      .sort((a, b) => a.ahead - b.ahead);
    const best = candidates[0]?.r;
    if (!best) continue;
    const leave = atLocalMinute(+now, best.departureMin);
    out.push({
      subject: state.subject, kind: 'routine', routineId: best.id, from: best.from, to: best.to,
      leaveAt: new Date(leave).toISOString(),
      arriveFrom: new Date(leave + best.minutes.low * MINUTE).toISOString(),
      arriveTo: new Date(leave + best.minutes.high * MINUTE).toISOString(),
      days: best.days, of: best.of, dayType, confidence: best.days >= 8 ? 'established' : 'emerging',
    });
  }
  return out;
}

// ── Watch: what looks off ───────────────────────────────────────────────────

export const WATCH_KINDS = ['overdue', 'running-long', 'quiet'] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];

/** A routine counts as dependable enough to miss above this share. */
export const OVERDUE_MIN_SHARE = 0.5;
/** Grace after the end of the usual window before "hasn't left" is said. */
export const OVERDUE_GRACE_MINS = 10;
/** A journey is long past 1.3 × the slowest usual trip, and 20 min in. */
export const LONG_FACTOR = 1.3;
export const LONG_MIN_MINS = 20;
/** Away from home and silent this long, in the day, is worth a look. */
export const QUIET_MINS = 180;

export interface WatchItem {
  /** Stable per occurrence — a notifier sends each key once. */
  key: string;
  kind: WatchKind;
  subject: string;
  severity: 'watch' | 'alert';
  title: string;
  detail: string;
  at: string;
}

const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: LOCAL_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtClock = (t: number | string) => clockFmt.format(new Date(t));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What looks different from each person's own routine right now. Every rule
 * needs evidence both ways — a dependable routine AND a fresh reading that
 * contradicts it — so a dead phone or a thin history is silence, not an
 * alarm. PURE.
 */
export function watchItems(input: {
  routines: Routine[];
  routes: RouteInsight[];
  live: LiveState[];
  arrivals: ArrivalInsight[];
  names: Map<string, string>;
  homeIds: Set<string>;
  now: Date;
}): WatchItem[] {
  const { routines, routes, live, arrivals, names, homeIds, now } = input;
  const clock = localClock(now), dayType = dayTypeOf(clock.weekday);
  const name = (s: string) => names.get(s) ?? s;
  const out: WatchItem[] = [];
  for (const state of live) {
    const fresh = state.lastSeen != null && +now - +new Date(state.lastSeen) <= 30 * MINUTE;
    // Overdue: a dependable routine from here has passed its window unrun.
    if (fresh && state.placeId && !state.moving) {
      for (const r of routines) {
        if (r.subject !== state.subject || r.fromId !== state.placeId || r.dayType !== dayType) continue;
        if (routineShare(r) < OVERDUE_MIN_SHARE || ranToday(r, clock.date)) continue;
        const late = clockDelta(clock.minute, r.window[1]);
        if (late < OVERDUE_GRACE_MINS || late > 120) continue;
        out.push({
          key: `overdue:${r.id}:${clock.date}`, kind: 'overdue', subject: r.subject, severity: 'watch',
          title: `${name(r.subject)} hasn't left for ${r.to}`,
          detail: `Usually leaves ${hhmm(r.window[0])}–${hhmm(r.window[1])} on ${r.dayType}s (${r.days} of ${r.of}). Still at ${r.from} at ${fmtClock(+now)}.`,
          at: now.toISOString(),
        });
      }
    }
    // Running long: on the move from a known place for longer than any usual trip from it.
    if (fresh && state.moving && !arrivals.some((a) => a.subject === state.subject)) {
      const from = routes.filter((r) => r.subject === state.subject && r.fromId === state.moving!.fromId && r.samples >= 3);
      if (from.length) {
        const slowest = Math.max(...from.map((r) => r.high));
        const elapsed = (+now - +new Date(state.moving.departedAt)) / MINUTE;
        if (elapsed >= LONG_MIN_MINS && elapsed > slowest * LONG_FACTOR) {
          out.push({
            key: `running-long:${state.subject}:${state.moving.departedAt}`, kind: 'running-long', subject: state.subject, severity: 'alert',
            title: `${name(state.subject)}'s journey is running long`,
            detail: `Left ${from[0].from} at ${fmtClock(state.moving.departedAt)}, ${Math.round(elapsed)} min ago. Trips from there usually take under ${Math.round(slowest)} min.`,
            at: now.toISOString(),
          });
        }
      }
    }
    // Quiet: away from home, silent for hours, in the day.
    if (state.lastSeen && clock.minute >= 7 * 60 && clock.minute <= 22 * 60) {
      const silent = (+now - +new Date(state.lastSeen)) / MINUTE;
      const away = !(state.placeId && homeIds.has(state.placeId));
      if (away && silent >= QUIET_MINS && silent <= 24 * 60) {
        out.push({
          key: `quiet:${state.subject}:${state.lastSeen}`, kind: 'quiet', subject: state.subject, severity: 'watch',
          title: `No location from ${name(state.subject)} for ${Math.floor(silent / 60)} h ${Math.round(silent % 60)} m`,
          detail: `Last seen ${fmtClock(state.lastSeen)}${state.placeId ? '' : ', not at a known place'}. A flat battery or no signal reads the same.`,
          at: now.toISOString(),
        });
      }
    }
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'alert' ? -1 : 1));
}

// ── Patterns ────────────────────────────────────────────────────────────────

/** Departures from a set of places, as a weekday (Mon=0) × hour grid. PURE. */
export function departureGrid(routes: RouteInsight[], fromIds: Set<string>): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const seen = new Set<string>();
  for (const r of routes) {
    if (!fromIds.has(r.fromId)) continue;
    for (const t of r.trips) {
      // Two people leaving together are one departure from the house.
      const c = localClock(new Date(t.start));
      const key = `${c.date}:${Math.floor(c.minute / 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      grid[c.weekday][Math.floor(c.minute / 60)]++;
    }
  }
  return grid;
}

// ── The whole forecast ──────────────────────────────────────────────────────

export interface FamilyForecast {
  generatedAt: string;
  days: number;
  routines: Routine[];
  next: NextMove[];
  watch: WatchItem[];
  arrivals: ArrivalInsight[];
  /** Departures from home by weekday × hour. */
  departures: number[][];
}

/**
 * The forecast for everyone in `insights`, as of `now`. PURE. `homeIds` is
 * every place of kind home (the grandparents' is someone's home too — never
 * "quiet" there); `mainHome` is the house, whose departures make the pattern.
 */
export function buildForecast(insights: PresenceInsights, homeIds: Set<string>, now: Date, mainHome: string | null = null): FamilyForecast {
  const routines = routinesOf(insights.routes, now, insights.days);
  const names = new Map(insights.people.map((p) => [p.subject, p.displayName]));
  return {
    generatedAt: now.toISOString(),
    days: insights.days,
    routines,
    next: nextMoves(routines, insights.live, insights.arrivals, now),
    watch: watchItems({ routines, routes: insights.routes, live: insights.live, arrivals: insights.arrivals, names, homeIds, now }),
    arrivals: insights.arrivals,
    departures: departureGrid(insights.routes, mainHome ? new Set([mainHome]) : homeIds),
  };
}
