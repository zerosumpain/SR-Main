// Re-cut a stored GPS trace to uniform spacing.
//
// Tracks land in the database decimated by DISTANCE-DELTA (track.ts drops any
// point closer than 3 m to the last kept one), so point index tells you nothing
// about how far along you are. Every stage of segment matching wants the
// opposite: a point index that IS a distance, so that "500 m" is "50 points"
// and a genuine co-traversal advances both traces exactly one point per step.
//
// Everything here is pure and deterministic over its input, same contract as
// track.ts — the matcher is tested on synthetic traces with no database.

import { haversineM, type TrackPoint } from '../track';

/** Uniform spacing, metres. Half the 20 m match tolerance, deliberately: a
 *  step coarser than the tolerance could straddle a corner and miss a match. */
export const STEP_M = 10;

export interface ResampledTrack {
  lng: Float64Array;
  lat: Float64Array;
  /** NaN where the source had no altitude — never 0, which is a real altitude. */
  ele: Float64Array;
  /** Seconds from the start of the activity, matching activity_series. */
  t: Float64Array;
  /** Local direction of travel in radians, smoothed over a 40 m chord. */
  heading: Float64Array;
  n: number;
  /** True path length of the source trace, before resampling. */
  sourceDistanceM: number;
}

const EMPTY: ResampledTrack = {
  lng: new Float64Array(0),
  lat: new Float64Array(0),
  ele: new Float64Array(0),
  t: new Float64Array(0),
  heading: new Float64Array(0),
  n: 0,
  sourceDistanceM: 0,
};

/** Chord, in points, that a heading is measured over. One 10 m step is too
 *  short — GPS jitter alone swings it by tens of degrees. Two either side is
 *  a 40 m chord: stable on a straight, still responsive round a corner. */
const HEADING_SPAN = 2;

/**
 * Direction of travel at each point.
 *
 * This is what tells a westbound pass from an eastbound one over the very same
 * ground. Index distance cannot: at the turnaround of an out-and-back the two
 * passes are adjacent points, and no amount of index clustering separates them.
 */
export function trackHeadings(lng: Float64Array, lat: Float64Array, n: number): Float64Array {
  const heading = new Float64Array(n);
  if (n < 2) return heading;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - HEADING_SPAN);
    const b = Math.min(n - 1, i + HEADING_SPAN);
    const dLat = lat[b] - lat[a];
    const dLng = (lng[b] - lng[a]) * Math.cos((lat[i] * Math.PI) / 180);
    heading[i] = Math.atan2(dLng, dLat);
  }
  return heading;
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/** Elevation interpolation has to survive a partly-null altitude channel. */
function lerpEle(a: number | null, b: number | null, f: number): number {
  if (a == null && b == null) return NaN;
  if (a == null) return b as number;
  if (b == null) return a;
  return lerp(a, b, f);
}

/**
 * Emit a point every `stepM` along the trace, interpolating position, altitude
 * and time.
 *
 * The trailing partial step is dropped on purpose: keeping it would break the
 * invariant the whole matcher rests on (index × stepM = distance) to save at
 * most one sub-10 m point at the very end of a trace.
 */
export function resampleTrack(points: TrackPoint[], stepM = STEP_M): ResampledTrack {
  if (!points || points.length < 2) return EMPTY;

  const lng: number[] = [points[0][0]];
  const lat: number[] = [points[0][1]];
  const ele: number[] = [points[0][2] ?? NaN];
  const t: number[] = [points[0][3]];

  let acc = 0;
  let nextAt = stepM;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = haversineM([a[0], a[1]], [b[0], b[1]]);
    if (!(d > 0)) continue;

    while (nextAt <= acc + d) {
      const f = (nextAt - acc) / d;
      lng.push(lerp(a[0], b[0], f));
      lat.push(lerp(a[1], b[1], f));
      ele.push(lerpEle(a[2], b[2], f));
      // Time can only go forwards. A watch that re-sends an out-of-order
      // sample would otherwise produce a negative-duration effort, which
      // reads as a spectacular personal best.
      t.push(Math.max(t[t.length - 1], lerp(a[3], b[3], f)));
      nextAt += stepM;
    }
    acc += d;
  }

  const lngArr = Float64Array.from(lng);
  const latArr = Float64Array.from(lat);
  return {
    lng: lngArr,
    lat: latArr,
    ele: Float64Array.from(ele),
    t: Float64Array.from(t),
    heading: trackHeadings(lngArr, latArr, lngArr.length),
    n: lngArr.length,
    sourceDistanceM: acc,
  };
}

/**
 * Path length between two resampled indices, by great circle rather than
 * `count × stepM`. The two agree to within rounding on a straight line and
 * differ on a tight corner, and the honest number is the measured one.
 */
export function spanDistanceM(track: ResampledTrack, from: number, to: number): number {
  let total = 0;
  for (let i = from + 1; i <= to; i++) {
    total += haversineM([track.lng[i - 1], track.lat[i - 1]], [track.lng[i], track.lat[i]]);
  }
  return total;
}

/**
 * Cumulative ascent and descent over a resampled span.
 *
 * Same 1 m threshold as `elevationDelta` in track.ts and for the same reason:
 * barometric and GPS altitude both jitter at rest, and summing raw deltas
 * turns a flat kilometre into 30 m of "climb".
 */
export function spanElevation(
  track: ResampledTrack,
  from: number,
  to: number,
  threshold = 1,
): { gainM: number; lossM: number } {
  let gainM = 0;
  let lossM = 0;
  let reference: number | null = null;

  for (let i = from; i <= to; i++) {
    const e = track.ele[i];
    if (Number.isNaN(e)) continue;
    if (reference == null) {
      reference = e;
      continue;
    }
    const delta = e - reference;
    if (delta > threshold) {
      gainM += delta;
      reference = e;
    } else if (delta < -threshold) {
      lossM += -delta;
      reference = e;
    }
  }

  return { gainM, lossM };
}
