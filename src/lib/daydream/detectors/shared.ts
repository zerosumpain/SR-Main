// src/lib/daydream/detectors/shared.ts
//
// Helpers every detector uses. Pure.

import { metresBetween } from '../cluster';
import { MIN_COVERAGE } from '../types';
import type { DaydreamSnapshot, PlaceSummary } from '../snapshot-types';

/**
 * How near counts as "beside this thing" — 100 m, by the owner's instruction
 * (2026-08-26).
 *
 * Deliberately distinct from being AT a place. A place's radius is a
 * CLUSTERING parameter: it describes how wide the GPS scatter is around a spot
 * you stood in, and it is 200 m because that is what separates two shops on the
 * same street. Reusing it as a proximity threshold would mean "you are near
 * Sports Direct" fired from 200 m away in any direction, which on a high street
 * is several other shops.
 *
 * So `atPlace` asks "am I inside its scatter" and `placesNearby` asks "am I
 * within 100 m of its centre". They answer different questions and neither
 * substitutes for the other.
 */
export const NEARBY_M = 100;

/** Places the owner has not muted. `ignored` means "stop mentioning this one",
 *  and it has to be honoured by every detector, not just the one that asked. */
export function activePlaces(s: DaydreamSnapshot): PlaceSummary[] {
  return s.places.filter((p) => p.status === 'active');
}

/**
 * Places within `withinM` of the current position, nearest first.
 *
 * Measured from the place's CENTRE, and deliberately NOT widened to its radius
 * — see the note on NEARBY_M. A detector saying "you are beside X" is making a
 * claim about where the owner is standing, and it should be a tight one.
 */
export function placesNearby(s: DaydreamSnapshot, withinM = NEARBY_M): PlaceSummary[] {
  if (!s.current) return [];
  const { lat, lon } = s.current;
  return activePlaces(s)
    .map((p) => ({ p, d: metresBetween(lat, lon, p.lat, p.lon) }))
    .filter(({ d }) => d <= withinM)
    .sort((a, b) => a.d - b.d)
    .map(({ p }) => p);
}

/**
 * The place the owner is currently INSIDE — within its own scatter radius.
 *
 * A different question from `placesNearby`: this one is "where am I", that one
 * is "what is next to me". The trail's own `placeId` answers it directly when
 * the fix resolved to a place, and the geometry is the fallback.
 */
export function atPlace(s: DaydreamSnapshot): PlaceSummary | null {
  if (!s.current) return null;
  if (s.current.placeId) {
    const byId = activePlaces(s).find((p) => p.id === s.current!.placeId);
    if (byId) return byId;
  }
  const { lat, lon } = s.current;
  let best: PlaceSummary | null = null;
  let bestD = Infinity;
  for (const p of activePlaces(s)) {
    const d = metresBetween(lat, lon, p.lat, p.lon);
    if (d <= p.radiusM && d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/**
 * Whether the current position is trustworthy enough to say something about
 * where the owner is standing.
 *
 * Three ways it is not: there is no fix at all; the fix is old enough that they
 * could be miles away; or its accuracy circle is wide enough to cover several
 * streets. Any proximity claim built on one of those is a guess wearing a fact's
 * clothes — and with push as the default channel, it is a guess that buzzes.
 */
export function positionIsUsable(
  s: DaydreamSnapshot,
  opts: { maxAgeMins?: number; maxAccuracyM?: number } = {},
): boolean {
  const maxAge = opts.maxAgeMins ?? 15;
  const maxAcc = opts.maxAccuracyM ?? 150;
  if (!s.current) return false;
  if (s.current.ageMins > maxAge) return false;
  if (s.current.accuracyM != null && s.current.accuracyM > maxAcc) return false;
  return true;
}

/** Whether a window is observed enough to reason about at all. */
export function coveredEnough(coverage: number, min = MIN_COVERAGE): boolean {
  return coverage >= min;
}

/** Normalise a value into 0..1 against a soft ceiling, for score components. */
export function ramp(value: number, floor: number, ceiling: number): number {
  if (ceiling <= floor) return 0;
  return Math.min(1, Math.max(0, (value - floor) / (ceiling - floor)));
}

/** Loose text match, both directions, for matching an interest to a place name.
 *  Deliberately conservative: a false match here becomes a confident sentence
 *  about a shop the owner has never been in. */
export function looseMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Require a whole-word containment of something long enough to be a name.
  // Substring matching alone makes "art" match "Dartford".
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  if (shorter.length < 4) return false;
  return new RegExp(`\\b${shorter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(longer);
}

/** A stable local-day token for dedupe keys that should recur daily. */
export function dayToken(s: DaydreamSnapshot): string {
  return s.localDate;
}

/**
 * The instant local midnight began, for the timezone the owner actually lives
 * in.
 *
 * `setUTCHours(0,0,0,0)` is the tempting one-liner and it is wrong for eight
 * months of the year: under BST local midnight is 23:00 UTC the previous day,
 * so a stop at 00:30 local lands in "yesterday" and a detector asking "did this
 * happen today" answers about the wrong day. Same lesson the trails work
 * already paid for — a local day is not a UTC day.
 *
 * Derived by subtracting the local time-of-day from `now`, which is exact
 * except across a DST transition (Europe/London moves at 01:00), where it can
 * be an hour out for that one day. That is a better failure than being an hour
 * out for half the year.
 */
export function localDayStart(now: Date, tz = 'Europe/London'): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const secondsIntoDay = (num('hour') % 24) * 3600 + num('minute') * 60 + num('second');
  return new Date(now.getTime() - secondsIntoDay * 1000);
}
