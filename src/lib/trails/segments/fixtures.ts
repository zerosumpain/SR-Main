// Synthetic traces for the segment tests.
//
// Real GPX is the wrong tool for testing a matcher: you cannot say "these two
// are exactly 12 m apart for 600 m and then diverge" about a recorded walk, so
// a failure tells you nothing about which threshold moved. These build a trace
// from waypoints in plain metres, east and north of an arbitrary origin.

import type { TrackPoint } from '../track';
import { resampleTrack } from './resample';
import type { SegmentSource } from './matcher';

const BASE_LAT = 53;
const BASE_LNG = -1.5;
// Derived from the same earth radius haversineM uses, so "600 m east" in a
// fixture is 600 m to the code under test. Borrowing a textbook 111320 instead
// puts every synthetic distance 0.6 % out, which is enough to move a point
// count by one and send you hunting for a bug that is in the test.
const EARTH_RADIUS_M = 6371008.8;
const M_PER_DEG_LAT = (EARTH_RADIUS_M * Math.PI) / 180;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((BASE_LAT * Math.PI) / 180);

export type Metres = [east: number, north: number];

export interface TrackOptions {
  speedMps?: number;
  /** Distance between raw points, before resampling. */
  spacingM?: number;
  /** Altitude as a function of distance travelled. */
  ele?: ((distanceM: number) => number) | null;
  /** Seconds before the trace starts moving. */
  startAtS?: number;
}

export function makeTrack(waypoints: Metres[], options: TrackOptions = {}): TrackPoint[] {
  const { speedMps = 2, spacingM = 5, ele = null, startAtS = 0 } = options;
  const points: TrackPoint[] = [];
  let travelled = 0;

  const emit = (east: number, north: number) => {
    points.push([
      BASE_LNG + east / M_PER_DEG_LNG,
      BASE_LAT + north / M_PER_DEG_LAT,
      ele ? ele(travelled) : null,
      startAtS + travelled / speedMps,
    ]);
  };

  emit(waypoints[0][0], waypoints[0][1]);
  for (let i = 1; i < waypoints.length; i++) {
    const [e0, n0] = waypoints[i - 1];
    const [e1, n1] = waypoints[i];
    const length = Math.hypot(e1 - e0, n1 - n0);
    const steps = Math.max(1, Math.round(length / spacingM));
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      travelled += length / steps;
      emit(e0 + (e1 - e0) * f, n0 + (n1 - n0) * f);
    }
  }

  return points;
}

export function makeSource(
  activityId: string,
  waypoints: Metres[],
  options: TrackOptions & { activityType?: string; startDate?: number } = {},
): SegmentSource {
  return {
    activityId,
    activityType: options.activityType ?? 'walk',
    startDate: options.startDate ?? 1_700_000_000,
    track: resampleTrack(makeTrack(waypoints, options)),
  };
}
