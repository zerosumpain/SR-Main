// src/lib/home/presence/commuting.ts
//
// The drives and train rides in one person's window, each with the route it
// took — the "Commuting" list on /home/people/[subject] (spec: breaking
// /apple-app apart, decision D3). PURE: the loader (`movement.ts`) hands in the
// journeys it already segmented, the fixes along each, the stays and the place
// names, so every rule here is tested without a database or a clock.
//
// This is the ONE place a coordinate leaves presence for that page, and it is
// kept small on purpose: only car and rail journeys, only the newest
// `COMMUTE_MAX` of them, each route thinned to `ROUTE_MAX_POINTS` and rounded
// to about a metre. The stats beside it stay coordinate-free. The loader is
// behind the page's own gate (the owner, the person, their guardian), which is
// the same gate the journeys the stats are made from already sit behind.
//
// The mode is the page's: `modeBucket`, with the loader's rail test. A
// motorway can pass for a train and a bus in traffic for a walk — advisory,
// as every mode here is.

import type { Journey, JourneyFix } from './journeys';
import { modeBucket, visitAfter, visitBefore, type StatsVisit } from './stats';

/** Newest this many commuting journeys go to the page. */
export const COMMUTE_MAX = 30;
/** A route is thinned to at most this many points: a compact map on a phone
 *  draws nothing finer, and 30 of them stay well under 100 KB. */
export const ROUTE_MAX_POINTS = 120;

export type CommuteMode = 'car' | 'rail';

export interface Commute {
  /** The journey's start, epoch ms, as a string: stable across reloads. */
  id: string;
  startedAt: string;
  endedAt: string;
  mode: CommuteMode;
  distanceKm: number;
  minutes: number;
  meanSpeedKmh: number | null;
  /** The named place it left / arrived at; null when that end is unnamed. */
  fromLabel: string | null;
  toLabel: string | null;
  /** `[lon, lat]` pairs, Mapbox's order, first and last fix always kept. */
  route: Array<[number, number]>;
}

export interface CommuteOpts {
  now: Date;
  days: number;
  /** The loader's rail test for a `vehicle` journey (`railJourney`). */
  isRail?: (j: Journey) => boolean;
  /** Place id → name, as the stats use it (unnamed = null / absent). */
  labelOf: Map<string, string | null>;
  /** Stays, for an end the journey's own fixes do not place. */
  visits: StatsVisit[];
  /** The fixes along each journey, start to end inclusive. */
  fixesOf: (j: Journey) => JourneyFix[];
  max?: number;
  maxPoints?: number;
}

/**
 * Keep at most `max` items, evenly spaced, always including the first and the
 * last. The same stride sampling as `native-trails.downsample` (a route's ends
 * matter more than its interior); copied rather than imported so presence does
 * not depend on the phone contract's module.
 */
export function thin<T>(items: readonly T[], max: number): T[] {
  if (max <= 0) return [];
  if (items.length <= max) return items.slice();
  if (max === 1) return [items[0]];
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return out;
}

/** Five decimal places of a degree is about a metre. */
const coord = (v: number) => Math.round(v * 1e5) / 1e5;

/** A journey's fixes as a thinned `[lon, lat]` line. */
export function routeLine(fixes: readonly JourneyFix[], maxPoints = ROUTE_MAX_POINTS): Array<[number, number]> {
  const valid = fixes.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon));
  return thin(valid, maxPoints).map((f) => [coord(f.lon), coord(f.lat)]);
}

/**
 * The name of the place a journey left (`end = 'from'`) or reached (`'to'`).
 * The journey's own end fix wins when it sits inside a named place; otherwise
 * the stay it left from / arrived at within 20 minutes, as the repeated-trips
 * table reads it. Unnamed is null — never a coordinate, never "somewhere".
 */
export function endLabel(
  j: Journey,
  end: 'from' | 'to',
  labelOf: Map<string, string | null>,
  visits: StatsVisit[],
): string | null {
  const placeId = end === 'from' ? j.fromPlaceId : j.toPlaceId;
  const own = placeId ? labelOf.get(placeId) : null;
  if (own) return own;
  const v = end === 'from' ? visitBefore(j, visits) : visitAfter(j, visits);
  return v?.label ?? null;
}

/** Car and train journeys started in the window, newest first, capped, each
 *  with its thinned route. */
export function commutingJourneys(journeys: readonly Journey[], opts: CommuteOpts): Commute[] {
  const windowStart = opts.now.getTime() - opts.days * 86_400_000;
  const picked: Array<{ j: Journey; mode: CommuteMode }> = [];
  for (const j of journeys) {
    const t = j.startedAt.getTime();
    if (t < windowStart || t > opts.now.getTime()) continue;
    const b = modeBucket(j, opts.isRail);
    if (b === 'car' || b === 'rail') picked.push({ j, mode: b });
  }
  picked.sort((a, b) => b.j.startedAt.getTime() - a.j.startedAt.getTime());

  return picked.slice(0, opts.max ?? COMMUTE_MAX).map(({ j, mode }) => ({
    id: String(j.startedAt.getTime()),
    startedAt: j.startedAt.toISOString(),
    endedAt: j.endedAt.toISOString(),
    mode,
    distanceKm: j.distanceKm,
    minutes: j.minutes,
    meanSpeedKmh: j.meanSpeedKmh,
    fromLabel: endLabel(j, 'from', opts.labelOf, opts.visits),
    toLabel: endLabel(j, 'to', opts.labelOf, opts.visits),
    route: routeLine(opts.fixesOf(j), opts.maxPoints ?? ROUTE_MAX_POINTS),
  }));
}
