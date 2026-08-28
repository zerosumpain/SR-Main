// Pure geometry over a GPS trace. No DB, no network — every function here is
// deterministic over its input so the ingest and the planner can share it.
//
// A track point is stored (and passed around) as a tuple, matching the jsonb
// column shape exactly: [lng, lat, elevationM | null, secondsFromStart].
// Tuple rather than object because a 6,000-point run is ~40% smaller on the
// wire and the shape never varies.

export type TrackPoint = [lng: number, lat: number, ele: number | null, t: number];

export interface Bounds {
  n: number;
  s: number;
  e: number;
  w: number;
}

const EARTH_RADIUS_M = 6371008.8;

/** Great-circle distance in metres between two [lng, lat] pairs. */
export function haversineM(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);
  const h = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Drop points that add no shape.
 *
 * A watch samples at 1 Hz whether you are moving or not, so a run contains long
 * runs of near-identical points (traffic lights, gates, a pause to breathe).
 * Keeping a point only once the trace has moved `minGapM` from the last kept
 * one cuts a 10 km run from ~6,000 points to ~1,500 with no visible change to
 * the line.
 *
 * First and last points are always kept: the endpoints are the one part of a
 * trace a reader can check against reality.
 */
export function decimateTrack(points: TrackPoint[], minGapM = 3): TrackPoint[] {
  if (points.length <= 2) return [...points];

  const kept: TrackPoint[] = [points[0]];
  let anchor = points[0];

  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    if (haversineM([anchor[0], anchor[1]], [p[0], p[1]]) >= minGapM) {
      kept.push(p);
      anchor = p;
    }
  }

  kept.push(points[points.length - 1]);
  return kept;
}

export function trackBounds(points: TrackPoint[]): Bounds {
  if (!points.length) throw new Error('trackBounds: empty track');
  let n = -Infinity;
  let s = Infinity;
  let e = -Infinity;
  let w = Infinity;
  for (const [lng, lat] of points) {
    if (lat > n) n = lat;
    if (lat < s) s = lat;
    if (lng > e) e = lng;
    if (lng < w) w = lng;
  }
  return { n, s, e, w };
}

export function trackDistanceM(points: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineM([points[i - 1][0], points[i - 1][1]], [points[i][0], points[i][1]]);
  }
  return total;
}

/**
 * Cumulative ascent and descent in metres.
 *
 * `threshold` exists because barometric and GPS altitude both jitter by a metre
 * or two at rest. Summing every raw delta turns a flat 10 km into 300 m of
 * "climb". Only a sustained move of more than the threshold from the last
 * committed altitude counts.
 */
export function elevationDelta(
  points: TrackPoint[],
  threshold = 1,
): { gainM: number; lossM: number } {
  let gainM = 0;
  let lossM = 0;
  let reference: number | null = null;

  for (const [, , ele] of points) {
    if (ele == null) continue;
    if (reference == null) {
      reference = ele;
      continue;
    }
    const delta = ele - reference;
    if (delta > threshold) {
      gainM += delta;
      reference = ele;
    } else if (delta < -threshold) {
      lossM += -delta;
      reference = ele;
    }
  }

  return { gainM, lossM };
}

export interface ElevationSample {
  distanceM: number;
  elevationM: number;
}

/** Elevation against cumulative distance — the input to the profile chart. */
export function elevationProfile(points: TrackPoint[]): ElevationSample[] {
  const out: ElevationSample[] = [];
  let distanceM = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      distanceM += haversineM(
        [points[i - 1][0], points[i - 1][1]],
        [points[i][0], points[i][1]],
      );
    }
    const ele = points[i][2];
    if (ele != null) out.push({ distanceM, elevationM: ele });
  }
  return out;
}

export interface Split {
  index: number;
  distanceM: number;
  durationS: number;
  paceSPerKm: number;
  elevationGainM: number;
}

/**
 * Per-kilometre splits. The final split is returned even when short, with its
 * pace extrapolated to a full km so it is comparable — but `distanceM` reports
 * the true distance covered, so nothing is overstated.
 */
const MIN_TRAILING_SPLIT_M = 10;

export function computeSplits(points: TrackPoint[], splitM = 1000): Split[] {
  if (points.length < 2) return [];

  const splits: Split[] = [];
  let index = 1;
  let splitStartT = points[0][3];
  let splitDistance = 0;
  let segment: TrackPoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const step = haversineM([points[i - 1][0], points[i - 1][1]], [points[i][0], points[i][1]]);
    splitDistance += step;
    segment.push(points[i]);

    if (splitDistance >= splitM) {
      const durationS = points[i][3] - splitStartT;
      splits.push({
        index,
        distanceM: splitDistance,
        durationS,
        paceSPerKm: splitDistance > 0 ? (durationS / splitDistance) * 1000 : 0,
        elevationGainM: elevationDelta(segment).gainM,
      });
      index++;
      splitStartT = points[i][3];
      splitDistance = 0;
      segment = [points[i]];
    }
  }

  // Trailing partial split — reported, but never rounded up into a full one.
  // The floor is 10 m rather than 0: a run that overshoots the last kilometre
  // by a metre of GPS rounding should not gain a split row saying "0.00 km".
  if (splitDistance >= MIN_TRAILING_SPLIT_M) {
    const durationS = points[points.length - 1][3] - splitStartT;
    splits.push({
      index,
      distanceM: splitDistance,
      durationS,
      paceSPerKm: (durationS / splitDistance) * 1000,
      elevationGainM: elevationDelta(segment).gainM,
    });
  }

  return splits;
}
