// src/lib/daydream/rules/facts.ts
//
// The only things a proposed rule can see.
//
// Every value here is derived by our code from the snapshot and flattened to a
// scalar. That flattening is not a convenience — it is the boundary. A rule
// holding a reference to a place object could reach its coordinates; a rule
// holding `atPlaceKind: 'cafe'` cannot. Widening this list is a deliberate act
// with a security consequence, which is why it is one small file rather than a
// spread operator over the snapshot.
//
// PURE.

import { metresBetween } from '../cluster';
import { atPlace, placesNearby } from '../detectors/shared';
import { recurringInterests } from '../detectors/interest-meets-place';
import type { DaydreamSnapshot } from '../snapshot-types';
import type { FactKey } from './spec';

export type FactValue = number | string | boolean | null;
export type Facts = Record<FactKey, FactValue>;

/**
 * How long the owner has been at their current place, from the trail.
 *
 * Walks back from the newest fix while the place id holds. Returns 0 when they
 * are not at a known place — which is different from "just arrived", and rules
 * that care about the difference should test `atPlaceKind` too.
 */
export function minutesAtCurrentPlace(s: DaydreamSnapshot): number {
  const placeId = s.current?.placeId;
  if (!placeId) return 0;

  const positioned = s.trail.filter((t) => t.lat != null);
  let earliest: Date | null = null;
  for (let i = positioned.length - 1; i >= 0; i--) {
    if (positioned[i].placeId !== placeId) break;
    earliest = positioned[i].ts;
  }
  if (!earliest) return 0;
  return Math.max(0, Math.round((s.now.getTime() - earliest.getTime()) / 60000));
}

/** Metres to the nearest active place, or -1 when there is none to measure. */
function nearestPlace(s: DaydreamSnapshot): { distanceM: number; kind: string | null } {
  if (!s.current) return { distanceM: -1, kind: null };
  let best = Infinity;
  let kind: string | null = null;
  for (const p of s.places) {
    if (p.status !== 'active') continue;
    const d = metresBetween(s.current.lat, s.current.lon, p.lat, p.lon);
    if (d < best) {
      best = d;
      kind = p.kind;
    }
  }
  return Number.isFinite(best) ? { distanceM: Math.round(best), kind } : { distanceM: -1, kind: null };
}

/**
 * Flatten a snapshot to the fact vector rules run against.
 *
 * `null` means "not known", and the interpreter treats a comparison against
 * null as FALSE rather than coercing it — the same rule the detectors follow,
 * for the same reason: a missing reading is not a zero, and a rule that fires
 * because the sensor was down is the failure this whole design is arranged
 * against.
 */
export function extractFacts(s: DaydreamSnapshot): Facts {
  const at = atPlace(s);
  const nearest = nearestPlace(s);
  const nearby = placesNearby(s);

  const sleep = s.health.lastNightSleep;
  const baseline = s.health.sleepBaseline;

  const busySoon = s.calendar.available && !s.calendar.partial
    ? s.calendar.events.some(
        (e) => e.start >= s.now && e.start.getTime() - s.now.getTime() <= 2 * 3_600_000,
      )
    : null;

  const offersNearby = s.offers.available
    ? s.offers.items.filter((o) =>
        nearby.some((p) => (p.label ?? '').toLowerCase().includes(o.merchant.toLowerCase())),
      ).length
    : null;

  return {
    localHour: s.localHour,
    localDay: s.localDay,
    isWeekday: s.isWeekday,

    isHome: s.current?.isHome ?? null,
    mode: s.current?.mode ?? null,
    atPlaceKind: at?.kind ?? null,
    atPlaceIsNamed: at ? at.label != null : null,
    minutesAtCurrentPlace: minutesAtCurrentPlace(s),
    nearestPlaceDistanceM: nearest.distanceM,
    nearestPlaceKind: nearest.kind,
    positionAgeMins: s.current?.ageMins ?? null,

    trailSpanDays: s.trailSpanDays,
    coverage24h: s.coverage.last24h,
    coverage7d: s.coverage.last7d,

    daysSinceWorkout: s.health.daysSinceWorkout,
    sleepPerformance: sleep?.performance ?? null,
    sleepDropFromBaseline:
      sleep && baseline != null ? Math.round(baseline - sleep.performance) : null,
    readinessScore: s.health.readiness?.score ?? null,

    offersLiveCount: s.offers.available ? s.offers.items.length : null,
    offersNearbyCount: offersNearby,
    calendarBusyNext2h: busySoon,
    calendarPartial: s.calendar.available ? s.calendar.partial : null,
    unnamedPlaceCount: s.places.filter((p) => p.status === 'active' && !p.label).length,
    recurringInterestCount: recurringInterests(s.interests, s.now).length,
    // No ids here, deliberately. An id is a handle, and handles are how a
    // scalar allow-list stops being one.
  } satisfies Record<FactKey, FactValue> & { [k: string]: FactValue };
}

/** The place a rule's templates may name — the one it is standing at or beside.
 *  Returned separately from the facts so a rule can never hold the object. */
export function subjectPlaceLabel(s: DaydreamSnapshot): { id: string | null; label: string | null } {
  const at = atPlace(s);
  if (at) return { id: at.id, label: at.label };
  const [near] = placesNearby(s);
  return near ? { id: near.id, label: near.label } : { id: null, label: null };
}
