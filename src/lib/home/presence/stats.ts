// src/lib/home/presence/stats.ts
//
// One person's movement over a window, as figures: how they got about, how
// fast they walk, the trips that repeat, and how long they spend out of the
// house. PURE — the journeys and visits are loaded elsewhere (`movement.ts`)
// and `now` is injected, so every rule here is tested without a database or a
// clock (spec: household movement, section 5).
//
// Nothing here is a claim about method. A journey's mode comes from GPS speed
// alone, so the page labels the whole section "inferred from speed": a bus in
// traffic reads as a walk and a motorway reads as a train, and neither is
// stated as fact.

import type { Journey } from './journeys';
import { LOCAL_TZ } from './types';

export const MODE_BUCKETS = ['foot', 'car', 'rail', 'other'] as const;
export type ModeBucket = (typeof MODE_BUCKETS)[number];

/** Walking pace counts only journeys in this band (m/s). Below it is a dawdle
 *  or a stop-start errand; above it is a jog or a bike mislabelled. */
export const FOOT_MIN_MPS = 0.9;
export const FOOT_MAX_MPS = 2.5;
/** …and only journeys at least this long: a walk to the car is not a pace. */
export const PACE_MIN_METRES = 500;
/** A trip's end is the visit within this long of the journey's start/end. */
export const TRIP_LINK_MINS = 20;
/** A pair of places becomes a "common trip" at this many journeys. */
export const MIN_TRIP_COUNT = 3;
export const DEFAULT_WINDOW_DAYS = 30;

/** A stay at a place, as the stats need it. `label` null = unnamed. */
export interface StatsVisit {
  placeId: string;
  label: string | null;
  from: Date;
  to: Date;
}

export interface ModeTotals {
  count: number;
  metres: number;
  seconds: number;
}

export interface WalkingPace {
  medianMps: number;
  p75Mps: number;
  n: number;
  /** Weeks start Monday, Europe/London; `weekStart` is that Monday's local date. */
  weekly: { weekStart: string; medianMps: number; n: number }[];
}

export interface CommonTrip {
  fromLabel: string;
  toLabel: string;
  count: number;
  /** Median departure, local clock. */
  usualDeparture: string;
  medianSeconds: number;
  mode: ModeBucket;
}

export interface TimeOutDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  minutesOut: number;
  firstOut: string | null;
  lastIn: string | null;
}

export interface MovementStats {
  byMode: Record<ModeBucket, ModeTotals>;
  walkingPace: WalkingPace | null;
  commonTrips: CommonTrip[];
  timeOut: TimeOutDay[];
}

export interface MovementStatsOpts {
  days: number;
  now: Date;
  /** The home place. Without one there is no "out", and `timeOut` is empty. */
  homePlaceId?: string | null;
  /** Whether a `vehicle` journey looked like rail along its fixes. The journey
   *  carries no fixes of its own, so the loader answers this (`railJourney`). */
  isRail?: (j: Journey) => boolean;
}

// ── Mode ─────────────────────────────────────────────────────────────────────

/**
 * The trail's bands folded into the page's buckets. `walking` is on foot;
 * `vehicle` is a train where the fixes said rail (or were stored as rail at
 * ingest) and a car otherwise; `active` — running or cycling, which speed
 * cannot tell apart — and anything unknown is "other".
 */
export function modeBucket(j: Journey, isRail?: (j: Journey) => boolean): ModeBucket {
  switch (j.dominantMode) {
    case 'walking':
      return 'foot';
    case 'rail':
      return 'rail';
    case 'vehicle':
      return isRail?.(j) ? 'rail' : 'car';
    default:
      return 'other';
  }
}

// ── Small maths ──────────────────────────────────────────────────────────────

function seconds(j: Journey): number {
  return Math.max(0, (j.endedAt.getTime() - j.startedAt.getTime()) / 1000);
}

/** Average speed over the whole journey: distance over elapsed time. Not the
 *  median hop, which let dawdles through in SR-Health's companion rules. */
export function averageMps(j: Journey): number | null {
  const s = seconds(j);
  return s > 0 ? (j.distanceKm * 1000) / s : null;
}

/** Linear-interpolated quantile of a non-empty list. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Local time ───────────────────────────────────────────────────────────────

const DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: LOCAL_TZ });
const PARTS_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: LOCAL_TZ,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** The local date of an instant, YYYY-MM-DD. */
export function localDate(d: Date): string {
  return DATE_FMT.format(d);
}

function localParts(d: Date): { weekday: number; minuteOfDay: number } {
  const parts = PARTS_FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  return { weekday, minuteOfDay: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

/** A calendar date shifted by whole days. Date arithmetic on the DATE, so a
 *  clock change cannot move it. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the local week the instant falls in. */
export function localWeekStart(d: Date): string {
  return addDays(localDate(d), -localParts(d).weekday);
}

export function hhmm(minuteOfDay: number): string {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The instant a local date begins. Found by walking back from local noon, so
 *  it is right on the 23- and 25-hour days too. */
function localMidnight(date: string): Date {
  const noon = new Date(`${date}T12:00:00Z`);
  const { minuteOfDay } = localParts(noon);
  return new Date(noon.getTime() - minuteOfDay * 60_000);
}

// ── The stats ────────────────────────────────────────────────────────────────

export function movementStats(
  journeys: Journey[],
  visits: StatsVisit[],
  opts: MovementStatsOpts,
): MovementStats {
  const windowStart = new Date(opts.now.getTime() - opts.days * 86_400_000);
  const inWindow = journeys
    .filter((j) => j.startedAt >= windowStart && j.startedAt <= opts.now)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const bucketOf = new Map(inWindow.map((j) => [j, modeBucket(j, opts.isRail)]));

  return {
    byMode: byMode(inWindow, bucketOf),
    walkingPace: walkingPace(inWindow, bucketOf),
    commonTrips: commonTrips(inWindow, visits, bucketOf),
    timeOut: opts.homePlaceId ? timeOut(inWindow, visits, opts.homePlaceId, opts) : [],
  };
}

function byMode(journeys: Journey[], bucketOf: Map<Journey, ModeBucket>): MovementStats['byMode'] {
  const out = Object.fromEntries(
    MODE_BUCKETS.map((b) => [b, { count: 0, metres: 0, seconds: 0 }]),
  ) as Record<ModeBucket, ModeTotals>;
  for (const j of journeys) {
    const t = out[bucketOf.get(j)!];
    t.count++;
    t.metres += Math.round(j.distanceKm * 1000);
    t.seconds += Math.round(seconds(j));
  }
  return out;
}

/** The foot journeys a pace is read from: ≥ 500 m, average 0.9–2.5 m/s. */
export function paceJourneys(journeys: Journey[], bucketOf: Map<Journey, ModeBucket>): Array<{ j: Journey; mps: number }> {
  const out: Array<{ j: Journey; mps: number }> = [];
  for (const j of journeys) {
    if (bucketOf.get(j) !== 'foot') continue;
    if (j.distanceKm * 1000 < PACE_MIN_METRES) continue;
    const mps = averageMps(j);
    if (mps == null || mps < FOOT_MIN_MPS || mps > FOOT_MAX_MPS) continue;
    out.push({ j, mps });
  }
  return out;
}

function walkingPace(journeys: Journey[], bucketOf: Map<Journey, ModeBucket>): WalkingPace | null {
  const walks = paceJourneys(journeys, bucketOf);
  if (walks.length === 0) return null;
  const byWeek = new Map<string, number[]>();
  for (const w of walks) {
    const wk = localWeekStart(w.j.startedAt);
    const list = byWeek.get(wk) ?? [];
    list.push(w.mps);
    byWeek.set(wk, list);
  }
  const all = walks.map((w) => w.mps);
  return {
    medianMps: round2(quantile(all, 0.5)),
    p75Mps: round2(quantile(all, 0.75)),
    n: walks.length,
    weekly: [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, v]) => ({ weekStart, medianMps: round2(quantile(v, 0.5)), n: v.length })),
  };
}

const LINK_MS = TRIP_LINK_MINS * 60_000;

/** The visit the journey left from: the last one begun before it started,
 *  ending no more than 20 minutes before. */
function visitBefore(j: Journey, visits: StatsVisit[]): StatsVisit | null {
  let best: StatsVisit | null = null;
  for (const v of visits) {
    if (v.from > j.startedAt) continue;
    if (!best || v.from > best.from) best = v;
  }
  if (!best) return null;
  return j.startedAt.getTime() - best.to.getTime() <= LINK_MS ? best : null;
}

/** The visit the journey arrived at: the first one ending after it ended,
 *  starting no more than 20 minutes after. */
function visitAfter(j: Journey, visits: StatsVisit[]): StatsVisit | null {
  let best: StatsVisit | null = null;
  for (const v of visits) {
    if (v.to < j.endedAt) continue;
    if (!best || v.to < best.to) best = v;
  }
  if (!best) return null;
  return best.from.getTime() - j.endedAt.getTime() <= LINK_MS ? best : null;
}

function commonTrips(
  journeys: Journey[],
  visits: StatsVisit[],
  bucketOf: Map<Journey, ModeBucket>,
): CommonTrip[] {
  // Grouped by NAME, not place id: two places can carry one label (a house
  // and the road cluster outside it), and the reader sees names.
  const groups = new Map<string, { fromLabel: string; toLabel: string; journeys: Journey[] }>();
  for (const j of journeys) {
    const from = visitBefore(j, visits);
    const to = visitAfter(j, visits);
    // An unnamed end is "somewhere unnamed", and somewhere unnamed is not a trip.
    if (!from?.label || !to?.label) continue;
    const key = `${from.label}\u0000${to.label}`;
    const g = groups.get(key) ?? { fromLabel: from.label, toLabel: to.label, journeys: [] };
    g.journeys.push(j);
    groups.set(key, g);
  }

  const trips: CommonTrip[] = [];
  for (const g of groups.values()) {
    if (g.journeys.length < MIN_TRIP_COUNT) continue;
    const modeCount = new Map<ModeBucket, number>();
    for (const j of g.journeys) {
      const b = bucketOf.get(j)!;
      modeCount.set(b, (modeCount.get(b) ?? 0) + 1);
    }
    // Most common; ties go to the bucket listed first.
    let mode: ModeBucket = 'other';
    let best = 0;
    for (const b of MODE_BUCKETS) {
      const n = modeCount.get(b) ?? 0;
      if (n > best) ((best = n), (mode = b));
    }
    trips.push({
      fromLabel: g.fromLabel,
      toLabel: g.toLabel,
      count: g.journeys.length,
      usualDeparture: hhmm(quantile(g.journeys.map((j) => localParts(j.startedAt).minuteOfDay), 0.5)),
      medianSeconds: Math.round(quantile(g.journeys.map(seconds), 0.5)),
      mode,
    });
  }
  return trips.sort((a, b) => b.count - a.count || a.fromLabel.localeCompare(b.fromLabel));
}

/**
 * Minutes away from home per local day, with the first departure and the last
 * return. An outing is the gap between one stay at home and the next — but
 * only where a journey actually began inside it: a phone that went quiet
 * overnight splits a stay at home into two, and the hole between them is not
 * time out. An outing still under way runs to `now`.
 */
function timeOut(
  journeys: Journey[],
  visits: StatsVisit[],
  homePlaceId: string,
  opts: MovementStatsOpts,
): TimeOutDay[] {
  const home = visits
    .filter((v) => v.placeId === homePlaceId)
    .sort((a, b) => a.from.getTime() - b.from.getTime());

  const outings: Array<{ from: Date; to: Date; returned: boolean }> = [];
  const movedDuring = (a: Date, b: Date) => journeys.some((j) => j.startedAt >= a && j.startedAt < b);
  for (let i = 0; i < home.length; i++) {
    const left = home[i].to;
    const back = home[i + 1]?.from ?? null;
    const until = back ?? opts.now;
    if (until <= left || !movedDuring(left, until)) continue;
    outings.push({ from: left, to: until, returned: back != null });
  }

  const today = localDate(opts.now);
  const days: TimeOutDay[] = [];
  for (let k = opts.days - 1; k >= 0; k--) {
    const date = addDays(today, -k);
    const start = localMidnight(date);
    const end = localMidnight(addDays(date, 1));
    let ms = 0;
    let firstOut: Date | null = null;
    let lastIn: Date | null = null;
    for (const o of outings) {
      const a = Math.max(o.from.getTime(), start.getTime());
      const b = Math.min(o.to.getTime(), end.getTime(), opts.now.getTime());
      if (b > a) ms += b - a;
      if (o.from >= start && o.from < end && (!firstOut || o.from < firstOut)) firstOut = o.from;
      if (o.returned && o.to >= start && o.to < end && (!lastIn || o.to > lastIn)) lastIn = o.to;
    }
    days.push({
      date,
      minutesOut: Math.round(ms / 60_000),
      firstOut: firstOut ? hhmm(localParts(firstOut).minuteOfDay) : null,
      lastIn: lastIn ? hhmm(localParts(lastIn).minuteOfDay) : null,
    });
  }
  return days;
}
