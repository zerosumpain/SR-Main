// Journey cleaning and loop closure.
//
// SERVER-ONLY (see rings.ts).
//
// Input is ONE journey's fixes, already segmented by the existing
// `segmentJourneys()` in $lib/daydream/journeys — that function owns the
// question "when did this trip start and stop", and duplicating its stillness
// rule here would let a minute be both a journey and a visit. Phase 1 has no
// database, so this module takes the fixes it would have produced.
//
// Everything is a named, exported constant, and `detectLoops` hands back the
// set it actually used. That is not tidiness: the thresholds below are tuned on
// synthetic data and 33 days of real trail, and they will be wrong. Storing the
// set on each claim row is what makes retuning in week two a new number rather
// than an invalidated history.

import { haversineM, decimateTrack, type TrackPoint } from '$lib/trails/track';
import type { ActivityTypeName } from '$lib/trails/activity-meta';
import { STILL_MAX_GAP_MINS } from '$lib/daydream/types';
import { FILL_RADIUS_CELLS, MAX_FILL_TILES } from './fill';
import {
  bboxOf,
  pathLength,
  pointInRing,
  ringArea,
  ringPerimeter,
  segmentIntersection,
  windingNumber,
  type Vec2,
} from './rings';
import {
  TILE_ZOOM,
  localProjection,
  tileAreaM2,
  tileAt,
  tileCentre,
  tileFractional,
  tileKeyOf,
  tileSideM,
  type LocalProjection,
  type Tile,
} from './tiles';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export interface GeoThresholds {
  /** Scoring zoom. */
  zoom: number;
  /** Fixes reporting worse horizontal accuracy than this are noise. */
  maxAccuracyM: number;
  /** Above this, it is not a walk. Applied to the reported speed AND to the
   *  speed implied by consecutive fixes, which is the one that catches a
   *  misclassified drive.
   *
   *  This is the UNTYPED ceiling and the default one. A source that declares
   *  what the activity was gets `rideMaxSpeedKmh` instead — see below. */
  maxSpeedKmh: number;
  /**
   * The same ceiling for a fix the source DECLARED as cycling.
   *
   * Amendment 2 (John, 2026-08-29). Amendment 1 let cycling score but left the
   * 25 km/h ceiling applying to it, and the consequence was not "a ride
   * captures the slow parts of itself" — it was that 22.4% of every ride's legs
   * cut the journey, so two real rides arrived at the geometry as 45 and 60
   * separate segments. A shredded journey is far below the 400 m closure floor
   * and far too broken for the interior fill to enclose anything, so a ride
   * could only ever trample a line: the "snail trail that is a full loop"
   * John was looking at.
   *
   * 45 km/h is read off the corpus, not chosen by taste. Over 135,700 implied
   * leg speeds from 176 real rides (the 177th is dealt with below):
   *
   *     p50 19.8   p90 27.8   p95 30.4   p99 35.1   p99.9 39.7   max 59.5
   *
   * The cycling population ENDS at about 40 km/h — in 2.5 km/h bins the last
   * populated one is 37.5-40 with 456 legs, then 67, 18, 11, 10, 0, 0, 0, 1.
   * Above 45 km/h there are 22 legs in the whole corpus, 0.016%; above 50 there
   * is one. So the band 42.5-57.5 km/h is EMPTY on real cycling, and a ceiling
   * placed in it separates the two populations rather than slicing one.
   *
   * It is set at the top of that empty band rather than the bottom because the
   * 40-50 tail is sampling noise, not speed: the watch samples at 1 Hz (median
   * leg 1 s), and 12 m of GPS wander in one second reads as 43 km/h. Cutting
   * there would sever a journey on a jitter spike, which is the exact failure
   * being repaired.
   *
   * It still cuts a vehicle, and the corpus contains the proof rather than a
   * hypothetical: one track labelled `ride` has a median leg of 33 km/h, a p90
   * of 176 km/h and 1,122 legs over 40 km/h. It is a train or a car, and at a
   * 45 km/h ceiling it is still shredded — while a car at a UK 70-90 km/h is
   * 1.6-2x the ceiling and severed on every leg.
   *
   * This ceiling is NOT extended to untyped data. Life360 cannot tell a bike
   * from a car — `mode` is derived from GPS speed alone — so the trail keeps
   * `maxSpeedKmh`, and the raise reaches only a workout the owner's own watch
   * declared, after `type_override` has had its say.
   */
  rideMaxSpeedKmh: number;
  /**
   * The declared activity types the raised ceiling applies to.
   *
   * A list rather than a hard-coded pair so that the number and the population
   * it applies to are persisted together on every claim: a row whose stored
   * thresholds say `rideActivityTypes: []` was made under the old rule, and
   * that is legible without a git archaeology dig.
   */
  rideActivityTypes: readonly ActivityTypeName[];
  /** Movement modes that can never capture ground. */
  excludedModes: readonly string[];
  /**
   * Declared workout types this CALLER does not want to count. Empty by
   * default: since Amendment 1 (John, 2026-08-29) cycling captures ground like
   * anything else, and the filtering happens at the viewing layer.
   *
   * The field stays because it is a filter, not a policy — a caller that wants
   * a foot-only rebuild passes one — and because it is persisted in every
   * claim's `closure.thresholds`, so a run made under a different rule stays
   * legible as such rather than looking like a bug in the geometry.
   *
   * It is NOT the vehicle gate. `excludedModes` is what stops a car claiming
   * the county, and that one is a policy and stays one.
   */
  excludedActivityTypes: readonly ActivityTypeName[];
  /** A fix within this distance of the rolling anchor is stationary jitter. */
  jitterRadiusM: number;
  /** Longer than this between two fixes and the record has a HOLE in it. The
   *  ground between them was not observed, so the path is cut rather than
   *  bridged. */
  maxObservationGapS: number;
  /** Below this implied ground speed the phone was parked, not travelling. The
   *  distance-based jitter collapse cannot see this at a slow cadence. */
  minMovingKmh: number;
  /** Shape decimation after the jitter collapse. */
  decimateM: number;
  /** A journey shorter than this cannot close on endpoint proximity. */
  minClosedPathM: number;
  /** Absolute and proportional halves of the endpoint gap allowance. */
  endpointGapM: number;
  endpointGapFraction: number;
  /** The synthetic closing segment may not be a quarter of the whole walk. */
  maxClosingChordFraction: number;
  /** Floor and ceiling on a ring, in enclosed cells. */
  minEnclosedTiles: number;
  maxEnclosedTiles: number;
  /** How wide a ring must be to be an enclosure rather than a there-and-back,
   *  measured in CELLS. Width is 2 x area / perimeter, which is the ribbon's
   *  true width in the long-thin limit. */
  minRingWidthCells: number;
  /** Trample rasterisation refuses to interpolate across a leg longer or
   *  slower-sampled than these. Carried here so a claim row records the whole
   *  gate set, not the loop half of it. */
  maxInterpolationM: number;
  maxInterpolationS: number;
  /** Structuring-element radius, in cells, for the interior fill's
   *  morphological closing. See $lib/geo/fill. */
  fillRadiusCells: number;
  /** Ceiling on the interior ONE journey may be awarded, in cells. Must never
   *  exceed `maxEnclosedTiles`, or a journey that failed to close could be paid
   *  for more ground than one that closed. */
  maxFillTiles: number;
}

/**
 * The shipped gate set.
 *
 * The one fatal failure mode this feature has is a misclassified drive
 * enclosing half of County Durham in a single trip, so the speed and mode
 * gates are deliberately layered rather than trusted individually: the `mode`
 * column is derived from GPS speed alone and the trail contains fixes recorded
 * as `vehicle` at 399 km/h. 75 m of accuracy rather than 50 because poll-only
 * family phones report worse fixes than John's push stream and a 50 m gate
 * starves four of the five players.
 *
 * `excludedActivityTypes` is EMPTY, and that is Amendment 1 rather than an
 * oversight: cycling scores. Anyone who wants a foot-only view filters
 * `activity_type` at the read, which is what the ledger now records it for.
 *
 * The speed ceiling is now TWO numbers, and that is Amendment 2. Amendment 1
 * left the 25 km/h ceiling applying to rides, on the reasoning that it was "a
 * gate about cars, not about sports" and a ride would simply capture the parts
 * of itself ridden at a human pace. Measured against the real corpus that
 * reasoning was wrong: 22.4% of a ride's legs are over 25 km/h, so the gate did
 * not trim a ride's fast sections, it SHREDDED the journey — 45 and 60 segments
 * out of two real rides — and a shredded journey can neither close nor be
 * filled. A ride could only ever paint a line. `rideMaxSpeedKmh` is the repair
 * and its 45 is read off that corpus; the untyped 25 is untouched, because
 * Life360 cannot tell a bike from a car.
 */
export const GEO_THRESHOLDS: GeoThresholds = Object.freeze({
  zoom: TILE_ZOOM,
  maxAccuracyM: 75,
  maxSpeedKmh: 25,
  rideMaxSpeedKmh: 45,
  rideActivityTypes: Object.freeze(['ride', 'mtb']) as readonly ActivityTypeName[],
  excludedModes: Object.freeze(['vehicle', 'rail']) as readonly string[],
  excludedActivityTypes: Object.freeze([]) as readonly ActivityTypeName[],
  jitterRadiusM: 25,
  maxObservationGapS: STILL_MAX_GAP_MINS * 60,
  minMovingKmh: 1,
  decimateM: 10,
  minClosedPathM: 400,
  endpointGapM: 60,
  endpointGapFraction: 0.05,
  maxClosingChordFraction: 0.25,
  minEnclosedTiles: 2,
  maxEnclosedTiles: 1000,
  minRingWidthCells: 0.5,
  maxInterpolationM: 300,
  maxInterpolationS: 180,
  fillRadiusCells: FILL_RADIUS_CELLS,
  maxFillTiles: MAX_FILL_TILES,
});

/**
 * Work guard, not a rule: the largest bbox, in candidate cells, that the
 * centroid scan will walk before giving up and calling the ring oversized.
 * 250k cells is about 11 km square at z19. A ring that big is a data fault,
 * and the alternative to a guard is an hourly heartbeat that hangs.
 */
export const MAX_BBOX_TILES = 250_000;

export function resolveThresholds(overrides?: Partial<GeoThresholds>): GeoThresholds {
  return Object.freeze({ ...GEO_THRESHOLDS, ...(overrides ?? {}) });
}

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------

export interface GeoFix {
  lat: number;
  lon: number;
  ts: Date;
  /** Reported horizontal accuracy. Absent means unknown, which is not a reason
   *  to drop the fix — most of the Life360 corpus has none. */
  accuracyM?: number | null;
  speedKmh?: number | null;
  mode?: string | null;
  /**
   * The DECLARED activity, where the source knows one — an Apple workout's
   * normalised type (`$lib/trails/activity-meta`'s vocabulary, after
   * `effectiveType()` has applied the owner's correction). Life360 never
   * carries one, so it is optional and its absence is never a reason to drop
   * a fix.
   *
   * Since Amendment 1 it is carried for the LEDGER's sake, not for a gate: it
   * ends up on every capture event and claim so the map and the boards can be
   * filtered after the fact. `excludedActivityTypes` reads it too, but only
   * when a caller has asked for that.
   */
  activityType?: string | null;
}

export interface DropCounts {
  accuracy: number;
  mode: number;
  /** Fixes the CALLER's activity-type filter excluded. Zero unless one was
   *  passed: the shipped set excludes nothing. */
  activityType: number;
  /** Reported speed over the gate, plus legs whose implied speed was. */
  speed: number;
  /** Fixes whose leg was too SLOW to be travel: a parked phone. */
  dwell: number;
  /** Runs cut because the record had a hole in it. */
  gap: number;
  jitter: number;
  decimated: number;
}

export interface CleanResult {
  /** Contiguous runs. A dropped vehicle leg splits a journey rather than
   *  bridging it, so a drive between two walks cannot draw a straight line
   *  across the county. */
  segments: GeoFix[][];
  dropped: DropCounts;
  thresholds: GeoThresholds;
}

const isFiniteFix = (f: GeoFix) => Number.isFinite(f.lat) && Number.isFinite(f.lon);

/** Implied ground speed of a leg, or null when the clock cannot say. */
function impliedKmh(a: GeoFix, b: GeoFix): number | null {
  const seconds = (b.ts.getTime() - a.ts.getTime()) / 1000;
  if (!(seconds > 0)) return null;
  const metres = haversineM([a.lon, a.lat], [b.lon, b.lat]);
  return (metres / seconds) * 3.6;
}

/**
 * The speed ceiling this ONE fix is judged against.
 *
 * The raise is keyed on the DECLARED type and nothing else. An absent type is
 * not a bike — it is Life360, where `mode` comes from GPS speed and a runner
 * and a cyclist both land in `active` — so the untyped default is the strict
 * ceiling and stays there. See `rideMaxSpeedKmh`.
 */
export function speedCeilingFor(fix: GeoFix, th: GeoThresholds): number {
  if (fix.activityType == null) return th.maxSpeedKmh;
  return (th.rideActivityTypes as readonly string[]).includes(fix.activityType)
    ? th.rideMaxSpeedKmh
    : th.maxSpeedKmh;
}

/**
 * The ceiling a LEG is judged against: the stricter of its two endpoints'.
 *
 * `min` rather than `max` because a leg is only as trustworthy as its weaker
 * end. A journey that is genuinely all one ride sees the raised ceiling on
 * every leg — every fix carries the same declared type — while a leg that
 * bridges a declared ride and an untyped fix is exactly the shape a
 * misattributed raise would arrive in, and it keeps the 25 km/h gate.
 */
function legCeiling(a: GeoFix, b: GeoFix, th: GeoThresholds): number {
  return Math.min(speedCeilingFor(a, th), speedCeilingFor(b, th));
}

/**
 * Drop fixes whose leg was too slow to be travel.
 *
 * Second half of the stationary defence; the first is the observation-gap cut
 * above. Together they close the hole that let a phone on a windowsill file
 * qualifying loop claims: 24 fixes over a night at Life360's 30-minute still
 * cadence, wandering 90-200 m between polls, arrived at the geometry as one
 * many-vertex tangle. It duly crossed itself, and every crossing was pushed out
 * as a weight-3 ring on the home cells — falsifying the spec's privacy point 5
 * ("a stationary day forms no claim") and offering a zero-effort way to farm
 * any ground you can leave a handset in. The two gates that should have caught
 * it are both inert on the real family corpus: most Life360 rows carry no
 * accuracy at all, and `mode` is frequently null. The 25 m jitter collapse
 * dropped nothing because consecutive wander steps are further apart than 25 m.
 *
 * The gap cut does the heavy lifting — at 30-minute polling every leg is a hole
 * in the record, so there is no path to draw. This one catches the same phone
 * polled fast enough to stay inside the gap but too slowly to be walking.
 *
 * The test is per-LEG, not against a rolling anchor. An anchor drifts: after a
 * half-hour stop a resuming walker would still read slow against the fix from
 * before the stop, and lose the start of the walk. Consecutive fixes cannot
 * drift, so a stop collapses and the resumption survives.
 *
 * 1 km/h is half the slowest sustained human walk and several times a wandering
 * phone. It is a stillness test, not a pace one — nothing about a real walk is
 * near it, and it deliberately does NOT try to be the `isMovingLeg` test from
 * $lib/daydream/journeys: that one requires 75 m of displacement per leg, which
 * is more than a real walk covers in a 45-second poll. It works there because
 * it decides run BOUNDARIES with a pending-absorption buffer, not because 75 m
 * is a per-fix truth.
 */
function collapseDwell(run: GeoFix[], minKmh: number): GeoFix[] {
  if (minKmh <= 0 || run.length < 2) return run;
  const out: GeoFix[] = [run[0]];
  for (let i = 1; i < run.length; i++) {
    const kmh = impliedKmh(run[i - 1], run[i]);
    if (kmh != null && kmh < minKmh) continue;
    out.push(run[i]);
  }
  return out;
}

/**
 * Rolling-anchor thinning, reusing the trails decimator so there is one
 * implementation of "has this moved far enough to matter".
 *
 * `decimateTrack` works on the jsonb track tuple, so fixes go in as
 * [lon, lat, null, index] and the index carries them back out. The index rather
 * than a timestamp because two fixes can share a second and a Map keyed on time
 * would silently merge them.
 */
function thin(points: GeoFix[], minGapM: number): GeoFix[] {
  if (minGapM <= 0 || points.length <= 2) return points;
  const tuples: TrackPoint[] = points.map((f, i) => [f.lon, f.lat, null, i]);
  return decimateTrack(tuples, minGapM).map((t) => points[t[3]]);
}

/**
 * Gate, split and thin one journey.
 *
 * Order is the spec's: accuracy, then mode and speed, then the stationary
 * collapse (dwell by speed, then jitter by distance — the two see different
 * sampling rates), then shape decimation. A hole in the record over
 * `maxObservationGapS` cuts the run in the same pass as the speed gate: the
 * ground between two fixes six minutes apart was not observed, and bridging it
 * draws a line through it. That bound is the daydream trail's own
 * STILL_MAX_GAP_MINS, imported rather than re-picked, so this module and
 * `segmentJourneys` cannot disagree about what continuous observation means.
 * An accuracy drop does NOT break the
 * run — it is noise removal, and the implied-speed test on the bridged leg is
 * what decides whether the gap was really a discontinuity. A mode or speed drop
 * DOES break it, because that is a different kind of travel, not a bad reading.
 * An excluded ACTIVITY TYPE breaks it for the same reason.
 */
export function cleanJourney(
  fixes: GeoFix[],
  overrides?: Partial<GeoThresholds>,
): CleanResult {
  const th = resolveThresholds(overrides);
  const dropped: DropCounts = {
    accuracy: 0,
    mode: 0,
    activityType: 0,
    speed: 0,
    dwell: 0,
    gap: 0,
    jitter: 0,
    decimated: 0,
  };

  const runs: GeoFix[][] = [];
  let current: GeoFix[] = [];
  const cut = () => {
    if (current.length) runs.push(current);
    current = [];
  };

  for (const f of fixes) {
    if (!isFiniteFix(f)) {
      cut();
      continue;
    }
    if (f.accuracyM != null && f.accuracyM > th.maxAccuracyM) {
      dropped.accuracy++;
      continue;
    }
    if (f.mode != null && th.excludedModes.includes(f.mode)) {
      dropped.mode++;
      cut();
      continue;
    }
    // A CALLER-supplied filter, and normally a no-op — the shipped set is
    // empty. Kept as a cut rather than a plain skip so that when someone does
    // ask for a foot-only rebuild, a ride in the middle of a mixed journey
    // severs the path instead of drawing a straight line across the gap it
    // left behind, which is the same rule the vehicle cut follows.
    if (
      f.activityType != null &&
      (th.excludedActivityTypes as readonly string[]).includes(f.activityType)
    ) {
      dropped.activityType++;
      cut();
      continue;
    }
    if (f.speedKmh != null && f.speedKmh > speedCeilingFor(f, th)) {
      dropped.speed++;
      cut();
      continue;
    }
    const prev = current[current.length - 1];
    if (prev) {
      const kmh = impliedKmh(prev, f);
      if (kmh != null && kmh > legCeiling(prev, f, th)) {
        dropped.speed++;
        cut();
      } else if ((f.ts.getTime() - prev.ts.getTime()) / 1000 > th.maxObservationGapS) {
        dropped.gap++;
        cut();
      }
    }
    current.push(f);
  }
  cut();

  const segments = runs.map((run) => {
    const moving = collapseDwell(run, th.minMovingKmh);
    dropped.dwell += run.length - moving.length;
    const collapsed = thin(moving, th.jitterRadiusM);
    dropped.jitter += moving.length - collapsed.length;
    const decimated = thin(collapsed, th.decimateM);
    dropped.decimated += collapsed.length - decimated.length;
    return decimated;
  });

  return { segments, dropped, thresholds: th };
}

// ---------------------------------------------------------------------------
// Closure
// ---------------------------------------------------------------------------

export type ClosureMethod = 'endpoint' | 'self-intersection';

export interface ClosureRecord {
  method: ClosureMethod;
  /** Distance from the first vertex to the last, before closing. Zero for a
   *  self-intersection ring, which closes on a real point of the track. */
  gapM: number;
  /** Length of the path this ring was cut from. */
  pathM: number;
  /** The gate set in force when this claim was made. Persist it. */
  thresholds: GeoThresholds;
}

export interface QualifiedRing {
  /** Ring vertices as [lon, lat], matching activity_tracks.coordinates order. */
  ring: Array<[number, number]>;
  tiles: Tile[];
  /** The ring's own geometric area — the shoelace, honest because every ring
   *  handed out here is simple. This is what a hand-check of a claim measures. */
  areaM2: number;
  /**
   * The ground actually AWARDED: cell count x the per-latitude cell area, which
   * is the model every leaderboard uses.
   *
   * Both numbers are carried because they are different models and the gap
   * between them is the honest measure of how coarse the grid is on this shape.
   * A gate stated in m2 of ring and an award paid in cells can disagree, and on
   * a shape thinner than a cell they used to disagree badly — the thinness gate
   * exists to stop that class of shape reaching an award at all.
   */
  capturedAreaM2: number;
  /** 2 x area / perimeter, metres — the width gate's measure. Stored so a
   *  retune can be argued from what actually shipped. */
  widthM: number;
  closure: ClosureRecord;
  /**
   * Which cleaned segment this ring came out of.
   *
   * Carried because the interior fill has to know. `cleanJourney` CUTS a
   * journey at a vehicle leg, a speed-gate breach or a hole in the record —
   * "a dropped vehicle leg splits a journey rather than bridging it" — and a
   * fill computed over the union of every segment's cells silently welds those
   * pieces back together. The segment is the unit the gates severed, so it has
   * to be the unit the fill reasons about.
   */
  segmentIndex: number;
}

export type RejectReason =
  | 'too-few-tiles'
  | 'too-many-tiles'
  | 'too-small'
  | 'too-short'
  | 'too-thin'
  | 'degenerate';

export interface RejectedRing {
  reason: RejectReason;
  tileCount: number;
  areaM2: number;
  capturedAreaM2: number;
  widthM: number;
  closure: ClosureRecord;
}

export interface LoopResult {
  rings: QualifiedRing[];
  rejected: RejectedRing[];
  /** The cleaned path, for trample capture. An out-and-back yields no ring but
   *  still yields ground. */
  segments: GeoFix[][];
  dropped: DropCounts;
  thresholds: GeoThresholds;
}

interface RingCandidate {
  ring: Vec2[];
  method: ClosureMethod;
  gapM: number;
  pathM: number;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** First transversal self-crossing, scanning forward. O(n^2) over a few dozen
 *  decimated points, which is nothing next to the database round trip. */
function firstSelfCrossing(
  points: Vec2[],
): { i: number; j: number; at: Vec2 } | null {
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      const at = segmentIntersection(points[i], points[i + 1], points[j], points[j + 1]);
      if (at) return { i, j, at };
    }
  }
  return null;
}

/**
 * Split a CLOSED ring into simple pieces.
 *
 * `firstSelfCrossing` scans i ascending, so the outermost crossing pops first
 * and the sub-path it lifts out can still contain crossings of its own. Those
 * used to be handed straight back as one ring, and a self-crossing ring is a
 * shape the shoelace cannot measure: opposite-wound lobes SUBTRACT. The number
 * that came out is the number stored as `geo_claims.area_m2`, hand-checked in
 * Phase 2, and gated on by the size floor — so an understated ring was both a
 * wrong claim area and a legitimate claim discarded as "too small".
 *
 * Splitting until every piece is simple is the root fix rather than measuring
 * the bad shape more cleverly: after it, `ringArea` is honest, the thinness
 * test below means what it says, and each lobe is separately gated instead of
 * averaging with its neighbour.
 *
 * The ring is walked with an explicit closing vertex so the last-to-first
 * segment takes part in the crossing scan. Index 0 and the last index are never
 * spliced out, so `work[0] === work[last]` holds throughout.
 */
function splitSimpleRings(ring: Vec2[]): Vec2[][] {
  if (ring.length < 4) return ring.length >= 3 ? [ring] : [];

  const out: Vec2[][] = [];
  let work: Vec2[] = [...ring, ring[0]];

  // Each pop removes at least one vertex, so this cannot spin.
  for (let guard = ring.length + 1; guard > 0; guard--) {
    const hit = firstSelfCrossing(work);
    if (!hit) break;
    out.push(...splitSimpleRings([hit.at, ...work.slice(hit.i + 1, hit.j + 1)]));
    work = [...work.slice(0, hit.i + 1), hit.at, ...work.slice(hit.j + 1)];
  }

  const rest = work.slice(0, work.length - 1); // drop the duplicated close
  if (rest.length >= 3) out.push(rest);
  return out;
}

/**
 * Cut every ring out of one cleaned path.
 *
 * Loop popping: each self-crossing is lifted out as its own ring and spliced
 * out of the working path, replaced by the crossing point. What is left is
 * tested for endpoint closure. That is what makes a figure-of-eight yield BOTH
 * lobes — the crossing gives one, and the remainder is then a simple loop that
 * closes on its own endpoints — and it is what lets a lollipop's head count
 * even though the runner stopped a quarter of a mile from where they started.
 *
 * Every popped ring is then split until it is simple (see above), so nothing
 * downstream ever measures a bowtie.
 *
 * NO LENGTH GATE LIVES HERE for the self-intersection branch, deliberately: a
 * crossing is proof of closure on its own, and how big the resulting ring has
 * to be is a qualification question, answered once in `detectLoops` where every
 * other floor and ceiling lives and where a rejection is recorded with a reason
 * instead of vanishing. The endpoint branch is different — its length IS part of
 * deciding whether the path closed at all, so it stays here.
 *
 * The endpoint test's third condition (closing chord under a quarter of the
 * path) is implied by the second for any path over 240 m, and the first
 * condition already requires 400 m. It is kept because it is the spec's, it is
 * free, and a future retune could lower `minClosedPathM` and need it.
 */
export function extractRings(points: Vec2[], th: GeoThresholds): RingCandidate[] {
  const out: RingCandidate[] = [];
  let work = points;

  // Each pop removes at least one vertex, so this cannot spin.
  for (let guard = points.length; guard > 0; guard--) {
    const hit = firstSelfCrossing(work);
    if (!hit) break;
    for (const ring of splitSimpleRings([hit.at, ...work.slice(hit.i + 1, hit.j + 1)])) {
      out.push({
        ring,
        method: 'self-intersection',
        gapM: 0,
        pathM: ringPerimeter(ring),
      });
    }
    work = [...work.slice(0, hit.i + 1), hit.at, ...work.slice(hit.j + 1)];
  }

  if (work.length >= 4) {
    const pathM = pathLength(work);
    const gapM = dist(work[0], work[work.length - 1]);
    const allowance = Math.max(th.endpointGapM, th.endpointGapFraction * pathM);
    if (
      pathM >= th.minClosedPathM &&
      gapM <= allowance &&
      gapM <= th.maxClosingChordFraction * pathM
    ) {
      out.push({ ring: work, method: 'endpoint', gapM, pathM });
    }
  }

  return out;
}

export interface EnclosedTiles {
  tiles: Tile[];
  /** True when the scan stopped early — the ring is over the ceiling, or its
   *  bounding box is beyond what the work guard will walk. */
  overflow: boolean;
}

/**
 * The cells a ring captures: every cell whose CENTROID falls inside it.
 *
 * Centroid rather than any-overlap because it is one predicate with no
 * partial-coverage argument, and because it is what makes the count a usable
 * area: N cells is N x the per-latitude constant, no geodesic library.
 */
export function enclosedTiles(
  ring: Vec2[],
  proj: LocalProjection,
  th: GeoThresholds,
): EnclosedTiles {
  if (ring.length < 3) return { tiles: [], overflow: false };

  const bb = bboxOf(ring);
  const nw = proj.toLatLon([bb.minX, bb.maxY]);
  const se = proj.toLatLon([bb.maxX, bb.minY]);
  const a = tileAt(nw.lat, nw.lon, th.zoom);
  const b = tileAt(se.lat, se.lon, th.zoom);
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);

  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_BBOX_TILES) return { tiles: [], overflow: true };

  const tiles: Tile[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const c = tileCentre(x, y, th.zoom);
      if (!pointInRing(proj.toM(c.lat, c.lon), ring)) continue;
      tiles.push({ x, y });
      // One past the ceiling is enough to reject; counting the rest of a
      // runaway ring is work nobody reads.
      if (tiles.length > th.maxEnclosedTiles) return { tiles, overflow: true };
    }
  }
  return { tiles, overflow: false };
}

/** A captured cell's centroid, back in the ring's own metre frame. */
function centreOf(tile: Tile, proj: LocalProjection, th: GeoThresholds): Vec2 {
  const c = tileCentre(tile.x, tile.y, th.zoom);
  return proj.toM(c.lat, c.lon);
}

/** Local metre frame anchored at the middle of the fixes, so the cos(lat)
 *  correction is right for the whole shape rather than for one end of it. */
function projectionFor(points: GeoFix[]): LocalProjection {
  let lat = 0;
  let lon = 0;
  for (const p of points) {
    lat += p.lat;
    lon += p.lon;
  }
  return localProjection(lat / points.length, lon / points.length);
}

/**
 * Clean a journey, cut its rings, and qualify them.
 *
 * Qualification is three gates in this order:
 *
 *  1. CEILING — over 1,000 cells (~2 km2) is not a walk. Checked first so a
 *     misclassified drive is named as such rather than as "too small".
 *  2. FLOOR, in cells — under 2 enclosed centroids is bus-stop jitter or the
 *     stationary-day polygon around the front door.
 *  3. FLOOR, in path length — a ring has to be as long a walk as the endpoint
 *     branch demands of one. Applies to the self-intersection branch, which had
 *     no size test of any kind: a phone left on a windowsill overnight produces
 *     a tangle that crosses itself repeatedly, and every crossing was a
 *     qualifying weight-3 claim on the home cells.
 *  4. FLOOR, in area — the spec states the cell floor as "~4,000 m2", and for
 *     a compact shape those are the same statement. For a SLIVER they are not:
 *     an out-and-back whose return leg sits 3 m off the outbound one is a
 *     600 m x 3 m ribbon, and whether it catches two centroids is pure lattice
 *     alignment — a 44 m shift of the same walk flips the answer. So the area
 *     form of the same floor (minEnclosedTiles x the per-latitude cell area) is
 *     checked as well. It introduces no new number.
 *  5. WIDTH — the area floor is necessary and not sufficient. A 600 m walk down
 *     one side of a road and back the other, 10-20 m across, measures
 *     6,000-12,000 m2 and sails over a 3,927 m2 floor, then collects a whole ROW
 *     of centroids along its length and is paid loop weight 3 for ground it
 *     never enclosed. That is not gaming; it is the commonest family walk shape,
 *     and it defeats the headline loop-3 / trample-1 distinction on every street
 *     they walk down and back.
 *
 *     The measure is 2 x area / perimeter, which is the ribbon's own width in
 *     the long-and-thin limit, and the bar is HALF A CELL. Both halves of that
 *     matter:
 *
 *     - Half a cell, rather than a number picked to taste, because the grid's
 *       resolution is the honest place to draw the line. A ring narrower than
 *       half a cell cannot enclose a centroid except by lattice luck — shift the
 *       same walk 22 m and the answer changes. Above it the ring contains real
 *       ground, and no geometry can tell "down and back a wide road" from
 *       "round a narrow block", because they are the same shape.
 *     - A width, rather than the isoperimetric quotient 4*pi*area/perimeter^2
 *       that this gate was first written as. That ratio is not scale-free and
 *       not lap-free, and both failures bite here: a 1,000 x 44 m block scores
 *       0.13 against a 400 x 40 m block's 0.26 though they are the same width,
 *       and ten laps of a 200 m square score 0.079 — same area, ten times the
 *       perimeter — so the gate threw away the exact claim the winding fix above
 *       had just rescued. 2 x area / perimeter is invariant to both.
 *
 *     Measured: 9.8 m for a 10 m-separated out-and-back, 19.4 m at 20 m, 37.5 m
 *     at 40 m, 36.4 m for a real 400 x 40 m block, 102 m for a 200 m square.
 */
export function detectLoops(
  fixes: GeoFix[],
  overrides?: Partial<GeoThresholds>,
): LoopResult {
  const th = resolveThresholds(overrides);
  const clean = cleanJourney(fixes, th);

  const rings: QualifiedRing[] = [];
  const rejected: RejectedRing[] = [];

  for (const [segmentIndex, segment] of clean.segments.entries()) {
    if (segment.length < 4) continue;
    const proj = projectionFor(segment);
    const metres: Vec2[] = segment.map((f) => proj.toM(f.lat, f.lon));

    for (const candidate of extractRings(metres, th)) {
      const closure: ClosureRecord = {
        method: candidate.method,
        gapM: candidate.gapM,
        pathM: candidate.pathM,
        thresholds: th,
      };
      const enclosed = enclosedTiles(candidate.ring, proj, th);
      const count = enclosed.tiles.length;

      // Divided by the winding multiplicity: a ring walked three times has
      // three times the shoelace of the ground it covers, and the ground is
      // what a claim's area means. Measured at a cell the ring actually
      // captured, so the sample is inside by construction. This is the other
      // half of the even-odd repair — restoring the tiles without it would have
      // handed Phase 2 a claim area three times the hand-check.
      const laps = count
        ? Math.abs(windingNumber(centreOf(enclosed.tiles[0], proj, th), candidate.ring))
        : 1;
      const areaM2 = ringArea(candidate.ring) / Math.max(1, laps);
      const perimeterM = ringPerimeter(candidate.ring) / Math.max(1, laps);
      const widthM = perimeterM > 0 ? (2 * areaM2) / perimeterM : 0;

      const bb = bboxOf(candidate.ring);
      const centre = proj.toLatLon([(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2]);
      const cellM2 = tileAreaM2(centre.lat, th.zoom);
      const capturedAreaM2 = count * cellM2;
      const reject = (reason: RejectReason) =>
        rejected.push({ reason, tileCount: count, areaM2, capturedAreaM2, widthM, closure });

      if (enclosed.overflow || count > th.maxEnclosedTiles) {
        reject('too-many-tiles');
        continue;
      }
      if (count < th.minEnclosedTiles) {
        reject('too-few-tiles');
        continue;
      }
      if (candidate.method === 'self-intersection' && candidate.pathM < th.minClosedPathM) {
        reject('too-short');
        continue;
      }
      if (areaM2 < th.minEnclosedTiles * cellM2) {
        reject('too-small');
        continue;
      }
      if (widthM < th.minRingWidthCells * tileSideM(centre.lat, th.zoom)) {
        reject('too-thin');
        continue;
      }

      rings.push({
        ring: candidate.ring.map((p): [number, number] => {
          const ll = proj.toLatLon(p);
          return [ll.lon, ll.lat];
        }),
        tiles: enclosed.tiles,
        areaM2,
        capturedAreaM2,
        widthM,
        closure,
        segmentIndex,
      });
    }
  }

  return { rings, rejected, segments: clean.segments, dropped: clean.dropped, thresholds: th };
}

// ---------------------------------------------------------------------------
// Trample
// ---------------------------------------------------------------------------

export interface TrampleResult {
  /** Cells the path crossed, deduplicated, in first-touched order. */
  tiles: Tile[];
  /** Legs the interpolation gate refused. Both endpoints are still stamped —
   *  the fixes themselves are evidence — but the ground between them is not. */
  refusedLegs: number;
  thresholds: GeoThresholds;
}

/**
 * The cells a journey's PATH crosses — the weight-1 half of the rules.
 *
 * `maxInterpolationM` and `maxInterpolationS` were declared, frozen and
 * persisted on every claim row for weeks with nothing reading them, because no
 * rasteriser existed. A gate nobody runs is worse than no gate: the next phase
 * reads the constant, believes it is enforced, and wires trample events against
 * it. This is the code that makes them true.
 *
 * Segments, never points — the Strava heatmap rule. At 45-120 s sampling
 * consecutive fixes are several cells apart, so stamping only the cells the
 * fixes sit in draws a dotted map of a walk that was continuous.
 *
 * And the refusal is the point of the constants: a poll gap of 12 km in 35
 * minutes implies 20.6 km/h, which is UNDER the 25 km/h speed gate and so
 * survives cleaning intact. Interpolated, it would stripe a line of ~270 cells
 * across the county in a straight line through fields nobody walked. Over
 * 300 m or over 180 s, the two fixes are stamped and the space between them is
 * left alone.
 *
 * The traversal is Amanatides-Woo over the tile lattice in FRACTIONAL slippy
 * coordinates rather than Bresenham over integers: it visits every cell the
 * segment actually passes through, including the ones it only clips a corner
 * of, so the painted line has no diagonal holes for the dissolve to trace
 * around.
 */
export function trampledTiles(
  fixes: GeoFix[],
  overrides?: Partial<GeoThresholds>,
): TrampleResult {
  const th = resolveThresholds(overrides);
  const tiles: Tile[] = [];
  const seen = new Set<string>();
  let refusedLegs = 0;

  const stamp = (x: number, y: number) => {
    const key = tileKeyOf(x, y);
    if (seen.has(key)) return;
    seen.add(key);
    tiles.push({ x, y });
  };

  const usable = fixes.filter(isFiniteFix);
  for (let i = 0; i < usable.length; i++) {
    const f = usable[i];
    const t = tileAt(f.lat, f.lon, th.zoom);
    stamp(t.x, t.y);
    if (i === 0) continue;

    const prev = usable[i - 1];
    const seconds = (f.ts.getTime() - prev.ts.getTime()) / 1000;
    const metres = haversineM([prev.lon, prev.lat], [f.lon, f.lat]);
    if (!(seconds >= 0) || seconds > th.maxInterpolationS || metres > th.maxInterpolationM) {
      refusedLegs++;
      continue;
    }
    for (const c of segmentTiles(prev, f, th.zoom)) stamp(c.x, c.y);
  }

  return { tiles, refusedLegs, thresholds: th };
}

/**
 * Every cell the segment a->b passes through, endpoints included.
 *
 * The step count is bounded by the Manhattan distance between the two end
 * cells plus a small allowance, so a degenerate input cannot spin: the walk
 * either reaches the end cell or is cut off, and being cut off paints less
 * ground, never more.
 */
function segmentTiles(a: GeoFix, b: GeoFix, zoom: number): Tile[] {
  const [ax, ay] = tileFractional(a.lat, a.lon, zoom);
  const [bx, by] = tileFractional(b.lat, b.lon, zoom);

  let x = Math.floor(ax);
  let y = Math.floor(ay);
  const ex = Math.floor(bx);
  const ey = Math.floor(by);

  const out: Tile[] = [{ x, y }];
  if (x === ex && y === ey) return out;

  const dx = bx - ax;
  const dy = by - ay;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;

  // Distance, in units of t along the segment, to the next lattice line.
  let tMaxX = dx === 0 ? Infinity : (dx > 0 ? x + 1 - ax : ax - x) / Math.abs(dx);
  let tMaxY = dy === 0 ? Infinity : (dy > 0 ? y + 1 - ay : ay - y) / Math.abs(dy);
  const tDeltaX = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const tDeltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);

  const budget = Math.abs(ex - x) + Math.abs(ey - y) + 2;
  for (let step = 0; step < budget && (x !== ex || y !== ey); step++) {
    if (tMaxX < tMaxY) {
      x += stepX;
      tMaxX += tDeltaX;
    } else {
      y += stepY;
      tMaxY += tDeltaY;
    }
    out.push({ x, y });
  }
  return out;
}
