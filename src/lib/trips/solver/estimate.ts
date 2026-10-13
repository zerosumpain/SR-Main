// src/lib/trips/solver/estimate.ts
//
// Distance × factor travel estimates: the test fixtures' matrix and the
// routing layer's last-resort fallback when no router answers. Every figure
// is marked `estimated: true`. Straight-line (haversine) distance is scaled
// by a network factor for the route length, then timed per mode:
//   walk    4.8 km/h
//   cycle   15 km/h
//   transit 15 min overhead (walk to the stop, waiting) + 18 km/h
//   drive   20 km/h (city traffic and parking)

import { TRAVEL_MODES, type LatLng, type TravelMatrix, type TravelMode } from '../model';

export const ESTIMATE_FACTORS = {
  /** Route length ÷ straight-line distance. */
  networkFactor: 1.3,
  kmh: { walk: 4.8, cycle: 15, transit: 18, drive: 20 } as Record<TravelMode, number>,
  /** Fixed time added to every non-zero transit leg, seconds. */
  transitOverheadSec: 15 * 60,
};

const EARTH_RADIUS_M = 6371008.8;

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** One estimated leg: whole seconds and whole metres. */
export function estimateLeg(a: LatLng, b: LatLng, mode: TravelMode): { seconds: number; metres: number } {
  const metres = Math.round(haversineM(a, b) * ESTIMATE_FACTORS.networkFactor);
  if (metres === 0) return { seconds: 0, metres: 0 };
  const travel = metres / ((ESTIMATE_FACTORS.kmh[mode] * 1000) / 3600);
  const overhead = mode === 'transit' ? ESTIMATE_FACTORS.transitOverheadSec : 0;
  return { seconds: Math.round(travel + overhead), metres };
}

/**
 * A full estimated matrix for the given points and modes (walk is always
 * included). Modes come out in the model's canonical order.
 */
export function estimateMatrix(
  points: Array<{ id: string; location: LatLng }>,
  modes: TravelMode[],
): TravelMatrix {
  const wanted = TRAVEL_MODES.filter((m) => m === 'walk' || modes.includes(m));
  const matrix: TravelMatrix = {
    points: points.map((p) => p.id),
    seconds: {},
    metres: {},
    estimated: {},
  };
  for (const mode of wanted) {
    const secs: number[][] = [];
    const metres: number[][] = [];
    for (const a of points) {
      const secRow: number[] = [];
      const mRow: number[] = [];
      for (const b of points) {
        const leg = a === b ? { seconds: 0, metres: 0 } : estimateLeg(a.location, b.location, mode);
        secRow.push(leg.seconds);
        mRow.push(leg.metres);
      }
      secs.push(secRow);
      metres.push(mRow);
    }
    matrix.seconds[mode] = secs;
    matrix.metres[mode] = metres;
    matrix.estimated[mode] = true;
  }
  return matrix;
}
