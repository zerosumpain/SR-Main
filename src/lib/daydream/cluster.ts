// src/lib/daydream/cluster.ts
//
// The geometry and time arithmetic behind the trail. PURE — no DB, no clock,
// no network — so every rule the feature reasons with is unit-testable against
// fabricated input. That property is the whole reason the detectors are rules
// rather than a prompt: a rule that fires on a measurable condition can be
// tested, and this file is where the measuring happens.
//
// The clusterer is lifted from src/routes/api/family-presence/stats/+server.ts,
// which had it inline. Same 200 m radius and same greedy assignment, so the two
// surfaces cannot disagree about what counts as one place; the endpoint should
// import from here rather than keep its copy.

import {
  ABSURD_SPEED_KMH,
  CLUSTER_RADIUS_M,
  MAX_SPEED_WINDOW_MINS,
  MODE_THRESHOLDS_KMH,
  MIN_COVERAGE,
  POLL_INTERVAL_MINS,
  RAIL_MAX_BEARING_DELTA_DEG,
  RAIL_MIN_FIXES,
  RAIL_MIN_KMH,
  STILL_MAX_GAP_MINS,
  STILL_RADIUS_M,
  VISIT_MAX_GAP_MINS,
  type Cluster,
  type ClusterPoint,
  type MovementMode,
  type PriorFix,
  type StayFix,
  type Visit,
} from './types';

const EARTH_R_KM = 6371;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Same, in metres — the unit every threshold in this feature is written in. */
export function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  return haversineKm(aLat, aLon, bLat, bLon) * 1000;
}

/** Initial bearing a→b in degrees, 0..360. */
export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const y = Math.sin(toRad(bLon - aLon)) * Math.cos(toRad(bLat));
  const x =
    Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) -
    Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLon - aLon));
  return (((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360;
}

/** Smallest angle between two bearings, 0..180 — so 359° and 1° are 2° apart. */
export function bearingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Greedy spatial clustering: each point joins the nearest existing cluster
 * within `radiusM`, or starts a new one. The centroid updates as a running
 * mean, so a cluster drifts toward its members rather than staying pinned to
 * whichever point happened to arrive first.
 *
 * Order-dependent by construction — feeding the same points in a different
 * order can split a borderline cluster differently. That is acceptable here
 * because a place only matters once it has repeat visits, by which point it is
 * far from borderline; callers should still pass points in time order so
 * results are reproducible.
 */
export function clusterPoints(points: ClusterPoint[], radiusM = CLUSTER_RADIUS_M): Cluster[] {
  const clusters: Cluster[] = [];

  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;

    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const d = metresBetween(p.lat, p.lon, clusters[i].lat, clusters[i].lon);
      if (d < radiusM && d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const c = clusters[bestIdx];
      c.members.push(p.idx);
      const n = c.members.length;
      c.lat += (p.lat - c.lat) / n;
      c.lon += (p.lon - c.lon) / n;
    } else {
      clusters.push({ lat: p.lat, lon: p.lon, members: [p.idx] });
    }
  }

  return clusters;
}

/** Distance from a centroid to its furthest member, floored at the clustering
 *  radius so a place is never tighter than the resolution that found it. */
export function clusterRadiusM(
  centroidLat: number,
  centroidLon: number,
  members: Array<{ lat: number; lon: number }>,
  floorM = CLUSTER_RADIUS_M,
): number {
  let max = 0;
  for (const m of members) {
    const d = metresBetween(centroidLat, centroidLon, m.lat, m.lon);
    if (d > max) max = d;
  }
  return Math.max(floorM, Math.round(max));
}

/**
 * Split the fixes at one place into separate visits, and measure how much of
 * each was actually spent standing still.
 *
 * The naive version of this function — segment on a time gap, call the span
 * from first fix to last one the dwell — is what put 78 stretches of road into
 * the place graph. Three things went wrong with it, and this rewrite is aimed
 * at all three:
 *
 *   A ROUND TRIP IS NOT A STAY. Driving out past a junction at 10:43 and back
 *   past it at 11:07 produced two fixes 24 minutes apart, inside one 200 m
 *   cluster, with no gap large enough to split them. The span said 24 minutes;
 *   nobody had stopped for a second of it. Time only accrues here between
 *   fixes that are close together in BOTH space and time, so the hole in the
 *   middle of a round trip counts for nothing.
 *
 *   A HOUSEHOLD IS NOT A PERSON. The trail carries five people since the D1
 *   decision, and feeding all five sets of timestamps into one segmenter welds
 *   them together: three family members passing the same junction within a
 *   minute of each other read as one visit, and 55% of qualifying visits on
 *   production mixed more than one person. It also wrecks the real places —
 *   home came out as 12 visits with a 53-hour median dwell, both figures
 *   fiction. Visits are per subject; the household aggregate is a SUM of those,
 *   which is a different and defensible thing.
 *
 *   SPEED WAS RECORDED AND NEVER READ. Every trail row carries `speed_kmh` and
 *   `mode`, and the old place builder consulted neither. This one does not read
 *   them either — but only because it measures the same thing better: `mode` is
 *   derived against the previous fix wherever that was, so it is wrong on
 *   arrival, whereas displacement between two fixes INSIDE the cluster is a
 *   direct observation of whether you moved.
 *
 * Returns visits ordered by start, across all subjects.
 */
export function segmentVisits(
  fixes: StayFix[],
  opts: { maxGapMins?: number; stillRadiusM?: number; stillMaxGapMins?: number } = {},
): Visit[] {
  const maxGapMins = opts.maxGapMins ?? VISIT_MAX_GAP_MINS;
  const stillRadiusM = opts.stillRadiusM ?? STILL_RADIUS_M;
  const stillMaxGapMins = opts.stillMaxGapMins ?? STILL_MAX_GAP_MINS;

  const bySubject = new Map<string, StayFix[]>();
  for (const f of fixes) {
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
    const list = bySubject.get(f.subject) ?? [];
    list.push(f);
    bySubject.set(f.subject, list);
  }

  const visits: Visit[] = [];

  for (const [subject, list] of bySubject) {
    const ordered = [...list].sort((a, b) => a.ts.getTime() - b.ts.getTime());

    let run: StayFix[] = [];
    const closeRun = () => {
      if (run.length === 0) return;
      const startedAt = run[0].ts;
      const endedAt = run[run.length - 1].ts;

      // The measurement. An interval counts only when it is short enough to be
      // continuous observation AND small enough to be standing still; anything
      // else is a hole in the record or a journey, and neither is time spent.
      let dwellMs = 0;
      for (let i = 1; i < run.length; i++) {
        const gapMins = (run[i].ts.getTime() - run[i - 1].ts.getTime()) / 60_000;
        if (gapMins > stillMaxGapMins) continue;
        const moved = metresBetween(run[i - 1].lat, run[i - 1].lon, run[i].lat, run[i].lon);
        if (moved > stillRadiusM) continue;
        dwellMs += run[i].ts.getTime() - run[i - 1].ts.getTime();
      }

      visits.push({
        subject,
        startedAt,
        endedAt,
        dwellMins: Math.round(dwellMs / 60_000),
        spanMins: Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000),
        fixCount: run.length,
      });
      run = [];
    };

    for (const f of ordered) {
      if (run.length > 0) {
        const gapMins = (f.ts.getTime() - run[run.length - 1].ts.getTime()) / 60_000;
        if (gapMins > maxGapMins) closeRun();
      }
      run.push(f);
    }
    closeRun();
  }

  return visits.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

/** Median, rounded. Empty input is 0 rather than NaN — a place with no
 *  measurable dwell should sort last, not poison every comparison it enters. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]);
}

/**
 * Speed implied by two fixes, or null when the pair cannot support one.
 *
 * Three ways it returns null, all of them deliberate: no usable previous
 * position; a window so wide the straight-line distance says nothing about
 * how fast you travelled; and an implied speed that is physically absurd,
 * which in practice means a bad fix rather than a fast journey. A null here
 * becomes mode `unknown`, never mode `still` — "I could not tell" and "you
 * did not move" are different claims.
 */
export function speedKmhBetween(
  prev: PriorFix | null,
  lat: number,
  lon: number,
  at: Date,
  maxWindowMins = MAX_SPEED_WINDOW_MINS,
): number | null {
  if (!prev || prev.lat == null || prev.lon == null) return null;

  const hours = (at.getTime() - prev.ts.getTime()) / 3_600_000;
  if (!(hours > 0)) return null;
  if (hours * 60 > maxWindowMins) return null;

  const km = haversineKm(prev.lat, prev.lon, lat, lon);
  const kmh = km / hours;
  if (!Number.isFinite(kmh) || kmh > ABSURD_SPEED_KMH) return null;

  return Math.round(kmh * 10) / 10;
}

/** Which speed band a fix sits in. Null speed is `unknown`, never `still`. */
export function inferMode(speedKmh: number | null): MovementMode {
  if (speedKmh == null || !Number.isFinite(speedKmh) || speedKmh < 0) return 'unknown';
  for (const band of MODE_THRESHOLDS_KMH) {
    if (speedKmh < band.under) return band.mode;
  }
  return 'vehicle';
}

/**
 * Whether recent movement looks like rail: enough consecutive fast fixes along
 * a near-constant bearing.
 *
 * This also matches a motorway, and there is no way to tell them apart without
 * map matching against the rail network. That is a known limit rather than a
 * bug — `rail` only ever softens the phrasing of a suggestion ("while you're
 * travelling") and is never asserted back to the owner as a fact.
 *
 * `recent` is newest-last and must be consecutive fixes, not a sample.
 */
export function looksLikeRail(
  recent: Array<{ lat: number; lon: number; speedKmh: number | null }>,
  opts: { minKmh?: number; minFixes?: number; maxBearingDeltaDeg?: number } = {},
): boolean {
  const minKmh = opts.minKmh ?? RAIL_MIN_KMH;
  const minFixes = opts.minFixes ?? RAIL_MIN_FIXES;
  const maxDelta = opts.maxBearingDeltaDeg ?? RAIL_MAX_BEARING_DELTA_DEG;

  if (recent.length < minFixes) return false;

  const window = recent.slice(-minFixes);
  if (!window.every((f) => f.speedKmh != null && f.speedKmh >= minKmh)) return false;

  // Bearings between consecutive members — one fewer than the fixes.
  const bearings: number[] = [];
  for (let i = 1; i < window.length; i++) {
    bearings.push(bearingDeg(window[i - 1].lat, window[i - 1].lon, window[i].lat, window[i].lon));
  }
  if (bearings.length < 2) return false;

  for (let i = 1; i < bearings.length; i++) {
    if (bearingDelta(bearings[i - 1], bearings[i]) > maxDelta) return false;
  }
  return true;
}

/**
 * What fraction of a window was actually observed.
 *
 * The poll floor aims for one observation every POLL_INTERVAL_MINS, so the
 * expected count over a window is known and coverage is a real fraction. Gap
 * rows are excluded from the numerator on purpose: a gap row proves the system
 * looked, which is worth recording, but it is not an observation of where you
 * were.
 *
 * This is the guard against the failure this whole design is arranged against
 * — a dead sensor read as a behaviour change. A detector reasoning about a
 * window checks `hasCoverage` first and stays silent when it fails.
 */
export function coverageOf(
  rows: Array<{ ts: Date; source: string }>,
  windowStart: Date,
  windowEnd: Date,
  pollIntervalMins = POLL_INTERVAL_MINS,
): number {
  const spanMins = (windowEnd.getTime() - windowStart.getTime()) / 60000;
  if (spanMins <= 0) return 0;

  const expected = Math.max(1, Math.floor(spanMins / pollIntervalMins));
  const observed = rows.filter(
    (r) =>
      r.source !== 'gap' &&
      r.ts.getTime() >= windowStart.getTime() &&
      r.ts.getTime() <= windowEnd.getTime(),
  ).length;

  return Math.min(1, observed / expected);
}

/** Whether a window is observed enough to reason about. */
export function hasCoverage(
  rows: Array<{ ts: Date; source: string }>,
  windowStart: Date,
  windowEnd: Date,
  minCoverage = MIN_COVERAGE,
): boolean {
  return coverageOf(rows, windowStart, windowEnd) >= minCoverage;
}
