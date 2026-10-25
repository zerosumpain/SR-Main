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
export const clockDeltaMinutes = clockDelta;

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
  /**
   * The weekdays it keeps to (0 = Monday), when it keeps to some and not the
   * rest of its day type — "Tue and Wed", not "weekdays". `days`/`of` then
   * count those weekdays only. Absent: every day of its type.
   */
  weekdays?: number[];
}

/** Days of each type in a window ending at `now`. */
function dayTypeCounts(now: number, days: number, skip: (date: string) => boolean = () => false): Record<DayType, number> {
  const out: Record<DayType, number> = { weekday: 0, weekend: 0 };
  for (let i = 0; i < days; i++) {
    const c = localClock(now - i * 86_400_000);
    if (!skip(c.date)) out[dayTypeOf(c.weekday)]++;
  }
  return out;
}

/** Each weekday's count in a window ending at `now` (index 0 = Monday). */
function weekdayCounts(now: number, days: number, skip: (date: string) => boolean = () => false): number[] {
  const out = Array<number>(7).fill(0);
  for (let i = 0; i < days; i++) {
    const c = localClock(now - i * 86_400_000);
    if (!skip(c.date)) out[c.weekday]++;
  }
  return out;
}

// ── School calendar ─────────────────────────────────────────────────────────

/** A stretch with no school: a half-term, a holiday, an INSET day. Local dates, inclusive. */
export interface Holiday {
  from: string;
  to: string;
  label?: string;
}

/**
 * The owner's hand-entered term breaks and the places they apply to. On a
 * holiday a routine to or from a school is not expected — not offered, not
 * "overdue", and the day is not counted against it.
 */
export interface SchoolCalendar {
  holidays: readonly Holiday[];
  schoolIds: ReadonlySet<string>;
}

export const NO_SCHOOL_CALENDAR: SchoolCalendar = { holidays: [], schoolIds: new Set() };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Holidays as stored, keeping only well-formed ranges, in date order. PURE. */
export function cleanHolidays(value: unknown): Holiday[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((h): h is Holiday => !!h && typeof h === 'object' && ISO_DATE.test((h as Holiday).from) && ISO_DATE.test((h as Holiday).to) && (h as Holiday).from <= (h as Holiday).to)
    .map((h) => ({ from: h.from, to: h.to, ...(typeof h.label === 'string' && h.label.trim() ? { label: h.label.trim().slice(0, 60) } : {}) }))
    .sort((a, b) => a.from.localeCompare(b.from));
}

/** The holiday a local date falls in, if any. PURE. */
export const holidayOn = (cal: SchoolCalendar, date: string): Holiday | null =>
  cal.holidays.find((h) => date >= h.from && date <= h.to) ?? null;

const isSchoolRoutine = (r: { fromId: string; toId: string }, cal: SchoolCalendar) => cal.schoolIds.has(r.fromId) || cal.schoolIds.has(r.toId);

/** Whether a routine is off for the day because school is. PURE. */
export const offForHoliday = (r: { fromId: string; toId: string }, cal: SchoolCalendar, date: string) =>
  isSchoolRoutine(r, cal) && holidayOn(cal, date) != null;

/** A weekday is one a routine keeps to when it ran on at least this share of them… */
export const WEEKDAY_KEEP_SHARE = 0.5;
/** …and the routine is narrowed to its kept weekdays only if no more than this share of runs fall outside them. */
export const WEEKDAY_STRAY_SHARE = 0.1;

/**
 * The weekdays a routine keeps to, or null when it keeps to all of its day
 * type (or the evidence is too thin to say). PURE.
 */
export function keptWeekdays(dates: string[], dayType: DayType, now: number, since: number, skip?: (date: string) => boolean): number[] | null {
  const ran = Array<number>(7).fill(0);
  for (const d of dates) ran[localClock(Date.parse(`${d}T12:00:00Z`)).weekday]++;
  const possible = weekdayCounts(now, since, skip);
  const ofType = [0, 1, 2, 3, 4, 5, 6].filter((w) => dayTypeOf(w) === dayType);
  const kept = ofType.filter((w) => ran[w] >= 2 && ran[w] >= possible[w] * WEEKDAY_KEEP_SHARE);
  if (!kept.length || kept.length === ofType.length) return null;
  const stray = ofType.filter((w) => !kept.includes(w)).reduce((n, w) => n + ran[w], 0);
  return stray <= dates.length * WEEKDAY_STRAY_SHARE ? kept : null;
}

/** Routines out of the learned routes. PURE. */
export function routinesOf(routes: RouteInsight[], now: Date, days: number, cal: SchoolCalendar = NO_SCHOOL_CALENDAR): Routine[] {
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
      // A school's holidays are not days it could have run.
      const skip = isSchoolRoutine(r, cal) ? (d: string) => holidayOn(cal, d) != null : undefined;
      const weekdays = keptWeekdays(dates, dayType, +now, since, skip);
      const keptDates = weekdays ? dates.filter((d) => weekdays.includes(localClock(Date.parse(`${d}T12:00:00Z`)).weekday)) : dates;
      const possible = weekdays ? weekdays.reduce((n, w) => n + weekdayCounts(+now, since, skip)[w], 0) : dayTypeCounts(+now, since, skip)[dayType];
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
        days: keptDates.length,
        of: Math.max(keptDates.length, possible),
        minutes: predictionBand(minutes),
        dates,
        ...(weekdays ? { weekdays } : {}),
      });
    }
  }
  return out.sort((a, b) => b.days - a.days);
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Where the NEXT trip will fall, from the ones seen: a prediction interval,
 * not a description of the past. With n trips sorted, the next lands between
 * the j-th smallest and j-th largest with probability (n + 1 − 2j)/(n + 1),
 * whatever the shape — so the band is the widest j that still promises 80%
 * (min to max below nine trips), and p80 is the k-th smallest with
 * k = ⌈0.8(n + 1)⌉. Plain p10–p90 of five trips held the next one only 53%
 * of the time on the family's real trips (backtest, 2026-10-25). PURE.
 */
export function predictionBand(values: number[]): { median: number; low: number; high: number; p80: number } {
  const v = [...values].sort((a, b) => a - b), n = v.length;
  if (!n) return { median: 0, low: 0, high: 0, p80: 0 };
  const j = Math.max(1, Math.floor(0.1 * (n + 1)));
  const k = Math.min(n, Math.ceil(0.8 * (n + 1)));
  return { median: round(percentile(v, 0.5)), low: round(v[j - 1]), high: round(v[n - j]), p80: round(v[k - 1]) };
}

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
 *
 * Not split by time of day: tried 2026-10-25, it moved the backtest's mean
 * error by under half a minute and narrowed the sample enough to worsen the
 * band. Family journeys here do not vary enough by hour to pay for it.
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
      ...predictionBand(clean),
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

/** Today is a day this routine runs on: its day type, and one of its weekdays if it keeps to some. */
export function runsOn(r: Routine, clock: { weekday: number }): boolean {
  return r.dayType === dayTypeOf(clock.weekday) && (!r.weekdays || r.weekdays.includes(clock.weekday));
}

// ── Corrections ─────────────────────────────────────────────────────────────

/**
 * Somebody who knows better saying a next move is wrong ("Katie isn't going
 * to the station"), from a long press on it in the app. Stored in
 * `forecast_feedback`; read back here so the forecast learns from it.
 */
export interface ForecastCorrection {
  subject: string;
  kind: 'routine' | 'arriving';
  /** The routine the move came from (`kind: 'routine'`). */
  routineId: string | null;
  /** The journey's departure (`kind: 'arriving'`), as the move carried it. */
  departedAt: string | null;
  /** The local date it was said on. */
  date: string;
}

/** Each correction weighs as this many days the routine did not run. */
export const CORRECTION_WEIGHT = 2;

/** Days on which a routine was called wrong and then did not run. */
function correctedDays(r: Routine, corrections: readonly ForecastCorrection[]): string[] {
  const days = corrections
    .filter((c) => c.kind === 'routine' && c.routineId === r.id && c.subject === r.subject && !r.dates.includes(c.date))
    .map((c) => c.date);
  return [...new Set(days)];
}

/**
 * How often a routine runs on its days, with corrections counted against it:
 * a day somebody said "not today" and was right weighs CORRECTION_WEIGHT
 * misses. PURE.
 */
export function correctedShare(r: Routine, corrections: readonly ForecastCorrection[] = []): number {
  const misses = correctedDays(r, corrections).length * CORRECTION_WEIGHT;
  return r.of + misses ? r.days / (r.of + misses) : 0;
}

function correctedToday(r: Routine, corrections: readonly ForecastCorrection[], today: string): boolean {
  return corrections.some((c) => c.kind === 'routine' && c.routineId === r.id && c.subject === r.subject && c.date === today);
}

/**
 * Each person's next likely move. A live arrival estimate wins; otherwise
 * the soonest routine that leaves from where they are now, later today, and
 * has not already run today. Nothing is offered for someone whose place is
 * unknown — a routine from "home" says nothing about a person who is not
 * there. PURE.
 */
export function nextMoves(
  routines: Routine[],
  live: LiveState[],
  arrivals: ArrivalInsight[],
  now: Date,
  corrections: readonly ForecastCorrection[] = [],
  cal: SchoolCalendar = NO_SCHOOL_CALENDAR,
): NextMove[] {
  const clock = localClock(now), dayType = dayTypeOf(clock.weekday);
  const out: NextMove[] = [];
  for (const state of live) {
    const arrival = arrivals.find((a) => a.subject === state.subject);
    // A journey somebody said is not going there is not offered again.
    const wrongArrival = arrival && corrections.some((c) =>
      c.kind === 'arriving' && c.subject === arrival.subject && c.departedAt === arrival.departedAt);
    if (arrival && wrongArrival) continue;
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
      .filter((r) => r.subject === state.subject && r.fromId === state.placeId && runsOn(r, clock) && !offForHoliday(r, cal, clock.date))
      // Called wrong today: not offered again today, and the day counts
      // against it from then on (`correctedShare`).
      .filter((r) => correctedShare(r, corrections) >= NEXT_MIN_SHARE && !ranToday(r, clock.date))
      .filter((r) => !correctedToday(r, corrections, clock.date))
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
      days: best.days, of: best.of, dayType,
      confidence: best.days >= 8 && !correctedDays(best, corrections).length ? 'established' : 'emerging',
    });
  }
  return out;
}

// ── Where next: the odds ────────────────────────────────────────────────────

/** Departures this far either side of the time of day count toward the odds. 90 beat
 *  60/120/180 on the backtest (2026-10-25): top pick right 68%, top two 76%. */
export const ODDS_WINDOW_MINS = 90;
/** Fewest departures before odds are offered. */
export const ODDS_MIN_SAMPLES = 4;
/** A trip this old counts half as much as one today. */
export const ODDS_HALF_LIFE_DAYS = 14;

export interface PlaceOdds {
  subject: string;
  fromId: string;
  from: string;
  /** Destinations, likeliest first; shares sum to at most 1 (the rest is "somewhere else"). */
  options: Array<{ toId: string; to: string; share: number; usual: string }>;
  /** Departures the odds stand on. */
  samples: number;
}

/**
 * Where someone at a place goes next, as shares: their own departures from
 * that place on this kind of day within ODDS_WINDOW_MINS of the time,
 * newer trips weighing more. Unlike a routine it never needs one answer to
 * dominate — "Town or the station" is still worth saying. PURE.
 */
export function placeOdds(routes: RouteInsight[], subject: string, fromId: string, now: Date, cal: SchoolCalendar = NO_SCHOOL_CALENDAR): PlaceOdds | null {
  const clock = localClock(now), dayType = dayTypeOf(clock.weekday);
  const holiday = holidayOn(cal, clock.date) != null;
  const weights = new Map<string, { to: string; w: number; minutes: number[] }>();
  let total = 0, samples = 0;
  for (const r of routes) {
    if (r.subject !== subject || r.fromId !== fromId) continue;
    if (holiday && isSchoolRoutine(r, cal)) continue;
    for (const t of r.trips) {
      const at = Date.parse(t.start);
      if (at > +now) continue;
      const c = localClock(at);
      if (dayTypeOf(c.weekday) !== dayType || Math.abs(clockDelta(c.minute, clock.minute + ODDS_WINDOW_MINS / 2)) > ODDS_WINDOW_MINS) continue;
      const w = Math.pow(0.5, (+now - at) / (ODDS_HALF_LIFE_DAYS * 86_400_000));
      const e = weights.get(r.toId) ?? { to: r.to, w: 0, minutes: [] };
      e.w += w; e.minutes.push(c.minute); weights.set(r.toId, e);
      total += w; samples++;
    }
  }
  if (samples < ODDS_MIN_SAMPLES || !total) return null;
  const from = routes.find((r) => r.fromId === fromId && r.subject === subject)?.from ?? fromId;
  const options = [...weights].map(([toId, e]) => ({ toId, to: e.to, share: Math.round((e.w / total) * 100) / 100, usual: hhmm(circularMedianMinute(e.minutes)) }))
    .sort((a, b) => b.share - a.share).slice(0, 3);
  return { subject, fromId, from, options, samples };
}

/** Odds for everyone sitting at a known place. PURE. */
export function oddsFor(routes: RouteInsight[], live: LiveState[], now: Date, cal: SchoolCalendar = NO_SCHOOL_CALENDAR): PlaceOdds[] {
  return live.filter((s) => s.placeId && !s.moving)
    .map((s) => placeOdds(routes, s.subject, s.placeId!, now, cal))
    .filter((o): o is PlaceOdds => o != null);
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
  corrections?: readonly ForecastCorrection[];
  cal?: SchoolCalendar;
}): WatchItem[] {
  const { routines, routes, live, arrivals, names, homeIds, now } = input;
  const corrections = input.corrections ?? [];
  const cal = input.cal ?? NO_SCHOOL_CALENDAR;
  const clock = localClock(now);
  const name = (s: string) => names.get(s) ?? s;
  const out: WatchItem[] = [];
  for (const state of live) {
    const fresh = state.lastSeen != null && +now - +new Date(state.lastSeen) <= 30 * MINUTE;
    // Overdue: a dependable routine from here has passed its window unrun.
    if (fresh && state.placeId && !state.moving) {
      for (const r of routines) {
        if (r.subject !== state.subject || r.fromId !== state.placeId || !runsOn(r, clock) || offForHoliday(r, cal, clock.date)) continue;
        if (correctedShare(r, corrections) < OVERDUE_MIN_SHARE || ranToday(r, clock.date)) continue;
        // "Not today", said already: their not leaving is the expected thing.
        if (correctedToday(r, corrections, clock.date)) continue;
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

// ── The day ahead ───────────────────────────────────────────────────────────

/** Most journeys chained into one person's day. */
const AHEAD_MAX_TRIPS = 6;

export type AheadSegment =
  | { kind: 'stay'; placeId: string | null; place: string; from: string; to: string; open: boolean }
  | {
      kind: 'trip'; fromId: string; toId: string; from: string; to: string;
      leave: string; arriveFrom: string; arriveTo: string; arrive: string;
      confidence: 'live' | 'established' | 'emerging'; routineId: string | null;
    };

export interface DayAhead {
  subject: string;
  /** Local midnight that ends the day. */
  until: string;
  segments: AheadSegment[];
}

/** The instant of the next local midnight after `now`. */
function nextMidnight(now: number): number {
  return now + (1440 - localClock(now).minute) * MINUTE - (now % MINUTE);
}

/**
 * Each person's rest of today, as their routines would have it: where they
 * are, then each dependable routine from there in turn — leave, the journey's
 * arrival window, the next place — to midnight. A live journey with an ETA
 * starts the chain where it is going. Someone whose place is unknown, or on a
 * journey with no ETA, gets no day: a guess from nowhere is not a plan. PURE.
 */
export function dayAhead(
  routines: Routine[], live: LiveState[], arrivals: ArrivalInsight[], now: Date,
  corrections: readonly ForecastCorrection[] = [], cal: SchoolCalendar = NO_SCHOOL_CALENDAR,
): DayAhead[] {
  const clock = localClock(now);
  const until = nextMidnight(+now);
  const out: DayAhead[] = [];
  for (const state of live) {
    const segments: AheadSegment[] = [];
    let placeId: string | null = state.placeId, place = '', at = +now;
    const arrival = arrivals.find((a) => a.subject === state.subject);
    if (arrival && !corrections.some((c) => c.kind === 'arriving' && c.subject === state.subject && c.departedAt === arrival.departedAt)) {
      segments.push({
        kind: 'trip', fromId: '', toId: arrival.toId, from: arrival.from, to: arrival.to, leave: arrival.departedAt,
        arriveFrom: arrival.earliest, arriveTo: arrival.latest, arrive: arrival.eta, confidence: 'live', routineId: null,
      });
      placeId = arrival.toId; place = arrival.to; at = Date.parse(arrival.eta);
    } else if (!state.placeId || state.moving) continue;
    const taken = new Set<string>();
    for (let n = 0; n < AHEAD_MAX_TRIPS && placeId && at < until; n++) {
      const minute = localClock(at).minute;
      const next = routines
        .filter((r) => r.subject === state.subject && r.fromId === placeId && runsOn(r, clock) && !offForHoliday(r, cal, clock.date))
        .filter((r) => !taken.has(r.id) && !ranToday(r, clock.date) && !correctedToday(r, corrections, clock.date))
        .filter((r) => correctedShare(r, corrections) >= NEXT_MIN_SHARE)
        // Still to come: leaves after we get there (a late start up to the end of its window).
        .filter((r) => clockDelta(r.window[1], minute) >= 0 && r.departureMin + r.minutes.median < 1440)
        .sort((a, b) => a.departureMin - b.departureMin)[0];
      const fromName = place || next?.from || routines.find((r) => r.fromId === placeId)?.from || '';
      if (!next) {
        segments.push({ kind: 'stay', placeId, place: fromName, from: new Date(at).toISOString(), to: new Date(until).toISOString(), open: true });
        break;
      }
      taken.add(next.id);
      const leave = Math.max(at, atLocalMinute(+now, next.departureMin));
      segments.push({ kind: 'stay', placeId, place: fromName, from: new Date(at).toISOString(), to: new Date(leave).toISOString(), open: false });
      const arrive = leave + next.minutes.median * MINUTE;
      segments.push({
        kind: 'trip', fromId: next.fromId, toId: next.toId, from: next.from, to: next.to, leave: new Date(leave).toISOString(),
        arriveFrom: new Date(leave + next.minutes.low * MINUTE).toISOString(), arriveTo: new Date(leave + next.minutes.high * MINUTE).toISOString(),
        arrive: new Date(arrive).toISOString(),
        confidence: next.days >= 8 && !correctedDays(next, corrections).length ? 'established' : 'emerging', routineId: next.id,
      });
      placeId = next.toId; place = next.to; at = arrive;
      if (n === AHEAD_MAX_TRIPS - 1 && at < until) {
        segments.push({ kind: 'stay', placeId, place, from: new Date(at).toISOString(), to: new Date(until).toISOString(), open: true });
      }
    }
    if (segments.length) out.push({ subject: state.subject, until: new Date(until).toISOString(), segments });
  }
  return out;
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
  /** Where each person at a known place is likeliest to go next. */
  odds: PlaceOdds[];
  /** Each person's rest of today, chained from their routines. */
  ahead: DayAhead[];
}

/**
 * The forecast for everyone in `insights`, as of `now`. PURE. `homeIds` is
 * every place of kind home (the grandparents' is someone's home too — never
 * "quiet" there); `mainHome` is the house, whose departures make the pattern.
 */
export function buildForecast(
  insights: PresenceInsights,
  homeIds: Set<string>,
  now: Date,
  mainHome: string | null = null,
  corrections: readonly ForecastCorrection[] = [],
  cal: SchoolCalendar = NO_SCHOOL_CALENDAR,
): FamilyForecast {
  const routines = routinesOf(insights.routes, now, insights.days, cal);
  const names = new Map(insights.people.map((p) => [p.subject, p.displayName]));
  return {
    generatedAt: now.toISOString(),
    days: insights.days,
    routines,
    next: nextMoves(routines, insights.live, insights.arrivals, now, corrections, cal),
    watch: watchItems({ routines, routes: insights.routes, live: insights.live, arrivals: insights.arrivals, names, homeIds, now, corrections, cal }),
    arrivals: insights.arrivals,
    departures: departureGrid(insights.routes, mainHome ? new Set([mainHome]) : homeIds),
    odds: oddsFor(insights.routes, insights.live, now, cal),
    ahead: dayAhead(routines, insights.live, insights.arrivals, now, corrections, cal),
  };
}
