// Synthetic journeys for the geometry fixtures, authored in LOCAL METRES around a
// Darlington origin and projected back to lat/lon. Building fixtures in metres is
// the only way to state "a 200 m square" and mean it — degrees of longitude are
// 0.58× degrees of latitude at 54.5°N, so a "square" in degrees is a rectangle on
// the ground and every area assertion would be wrong by 42%.
//
// Pure. No DB, no clock — every fixture takes its start time as an argument.

import { localProjection } from './tiles';
import type { Vec2 } from './rings';
import type { GeoFix } from './loops';

/** Darlington town centre — the corpus's real centre of mass. */
export const ORIGIN = { lat: 54.5236, lon: -1.5536 };

export interface WalkOptions {
  /** Sampling interval along the path, metres. */
  stepM?: number;
  /** Ground speed, metres per second. 1.4 m/s is a walk. */
  speedMps?: number;
  startTs?: Date;
  accuracyM?: number | null;
  mode?: string | null;
  /** Overrides the derived speed reported on each fix. */
  speedKmh?: number | null;
  origin?: { lat: number; lon: number };
}

/**
 * Sample a polyline given in metres into GeoFix rows.
 *
 * Corners are always emitted, so a shape's vertices survive sampling; the
 * cleaning pipeline is what is allowed to remove them, not the fixture builder.
 */
export function walk(corners: Vec2[], opts: WalkOptions = {}): GeoFix[] {
  const {
    stepM = 10,
    speedMps = 1.4,
    startTs = new Date('2026-08-01T09:00:00Z'),
    accuracyM = 10,
    mode = 'walking',
    speedKmh = null,
    origin = ORIGIN,
  } = opts;

  const proj = localProjection(origin.lat, origin.lon);
  const metres: Vec2[] = [];

  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(len / stepM));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      metres.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  metres.push(corners[corners.length - 1]);

  let travelled = 0;
  return metres.map((p, i) => {
    if (i > 0) travelled += Math.hypot(p[0] - metres[i - 1][0], p[1] - metres[i - 1][1]);
    const { lat, lon } = proj.toLatLon(p);
    return {
      lat,
      lon,
      ts: new Date(startTs.getTime() + (travelled / speedMps) * 1000),
      accuracyM,
      mode,
      speedKmh: speedKmh ?? speedMps * 3.6,
    } satisfies GeoFix;
  });
}

/** A closed square of `side` metres, anchored at its south-west corner. */
export function square(side: number, sw: Vec2 = [0, 0]): Vec2[] {
  const [x, y] = sw;
  return [
    [x, y],
    [x + side, y],
    [x + side, y + side],
    [x, y + side],
    [x, y],
  ];
}

/**
 * A stationary flower: fixes scattered on a small radius around one point, the
 * shape a phone draws while its owner is asleep. Deterministic, no RNG.
 */
export function jitterFlower(
  petals = 12,
  radiusM = 12,
  opts: WalkOptions = {},
): GeoFix[] {
  const { startTs = new Date('2026-08-01T02:00:00Z'), origin = ORIGIN } = opts;
  const proj = localProjection(origin.lat, origin.lon);
  const out: GeoFix[] = [];
  for (let i = 0; i < petals; i++) {
    const a = (i * 2 * Math.PI) / petals;
    // Radius wobbles so the flower is not a perfect circle a symmetry could hide.
    const r = radiusM * (0.6 + 0.4 * ((i * 7) % 5) / 4);
    const { lat, lon } = proj.toLatLon([Math.cos(a) * r, Math.sin(a) * r]);
    out.push({
      lat,
      lon,
      // Life360 polls a still phone every ~30 min.
      ts: new Date(startTs.getTime() + i * 30 * 60_000),
      accuracyM: 20,
      mode: 'still',
      speedKmh: 0,
    });
  }
  return out;
}
