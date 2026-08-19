// "Is this the same piece of ground as that?"
//
// Asked twice, by two different callers, and it must answer identically both
// times: the matcher asks it to collapse two candidate stretches proposed by
// different traces, and the rebuild asks it to recognise a recomputed segment
// as the stored one it should replace — which is what lets a segment keep its
// name and its URL across a rebuild.
//
// A corridor is a band of the given width around a line. Membership is a grid
// lookup, so testing a few hundred points against it is effectively free.

const EARTH_RADIUS_M = 6371008.8;
const M_PER_DEG_LAT = (EARTH_RADIUS_M * Math.PI) / 180;

export type LngLat = readonly [number, number, ...unknown[]];

export interface Corridor {
  toleranceM: number;
  count: number;
  lng0: number;
  lat0: number;
  kx: number;
  gx: Float64Array;
  gy: Float64Array;
  cells: Map<number, number[]>;
}

const CELL_OFFSET = 1_000_000;
const CELL_STRIDE = 4_000_000;

function cellKey(cx: number, cy: number): number {
  return (cx + CELL_OFFSET) * CELL_STRIDE + (cy + CELL_OFFSET);
}

export function makeCorridor(points: ArrayLike<LngLat>, toleranceM = 20): Corridor {
  const count = points.length;
  const gx = new Float64Array(count);
  const gy = new Float64Array(count);
  const cells = new Map<number, number[]>();

  if (!count) {
    return { toleranceM, count, lng0: 0, lat0: 0, kx: M_PER_DEG_LAT, gx, gy, cells };
  }

  const lng0 = points[0][0];
  const lat0 = points[0][1];
  const kx = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);

  for (let i = 0; i < count; i++) {
    gx[i] = (points[i][0] - lng0) * kx;
    gy[i] = (points[i][1] - lat0) * M_PER_DEG_LAT;
    const key = cellKey(Math.floor(gx[i] / toleranceM), Math.floor(gy[i] / toleranceM));
    const bucket = cells.get(key);
    if (bucket) bucket.push(i);
    else cells.set(key, [i]);
  }

  return { toleranceM, count, lng0, lat0, kx, gx, gy, cells };
}

/** Index of the corridor point nearest (lng, lat), or -1 if none is in range. */
export function nearestOn(corridor: Corridor, lng: number, lat: number): number {
  if (!corridor.count) return -1;
  const x = (lng - corridor.lng0) * corridor.kx;
  const y = (lat - corridor.lat0) * M_PER_DEG_LAT;
  const cx = Math.floor(x / corridor.toleranceM);
  const cy = Math.floor(y / corridor.toleranceM);

  let best = -1;
  let bestD2 = corridor.toleranceM * corridor.toleranceM;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = corridor.cells.get(cellKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (const i of bucket) {
        const ex = corridor.gx[i] - x;
        const ey = corridor.gy[i] - y;
        const d2 = ex * ex + ey * ey;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
    }
  }
  return best;
}

export interface CorridorMatch {
  /** Fraction of the sampled points that fell inside the corridor. */
  fraction: number;
  /** Whether those points ran along the corridor rather than against it. */
  forward: boolean;
}

/** Sampling cap: 120 points is plenty to decide "same ground", and it keeps
 *  the cost of comparing a long segment independent of its length. */
const MAX_SAMPLES = 120;

export function corridorMatch(corridor: Corridor, points: ArrayLike<LngLat>): CorridorMatch {
  if (!corridor.count || !points.length) return { fraction: 0, forward: false };

  const step = Math.max(1, Math.floor(points.length / MAX_SAMPLES));
  let sampled = 0;
  let matched = 0;
  let forward = 0;
  let backward = 0;
  let last = -1;

  for (let i = 0; i < points.length; i += step) {
    sampled++;
    const hit = nearestOn(corridor, points[i][0], points[i][1]);
    if (hit < 0) continue;
    matched++;
    if (last >= 0) {
      if (hit > last) forward++;
      else if (hit < last) backward++;
    }
    last = hit;
  }

  return { fraction: sampled ? matched / sampled : 0, forward: forward >= backward };
}

export interface SameGroundOptions {
  toleranceM?: number;
  /** Both the share that must fall inside the corridor and the shortest the
   *  one may be relative to the other. A 600 m core inside a 2 km stretch is
   *  the same ground but NOT the same segment. */
  minOverlap?: number;
}

export function sameGround(
  a: ArrayLike<LngLat>,
  b: ArrayLike<LngLat>,
  options: SameGroundOptions = {},
): boolean {
  const { toleranceM = 20, minOverlap = 0.8 } = options;
  if (!a.length || !b.length) return false;
  if (Math.min(a.length, b.length) / Math.max(a.length, b.length) < minOverlap) return false;
  const match = corridorMatch(makeCorridor(a, toleranceM), b);
  return match.fraction >= minOverlap && match.forward;
}
