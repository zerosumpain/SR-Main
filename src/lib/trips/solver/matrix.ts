// src/lib/trips/solver/matrix.ts
//
// The solver's context (pace rules, allowed modes, matrix lookups) and the
// leg-mode rule: walk when the walk takes no longer than the pace's walk
// limit, otherwise the fastest allowed mode the matrix has a route for;
// with no route at all, an estimated walk from the two coordinates.

import {
  PACE_RULES,
  TAXI_PICKUP_SEC,
  TRAVEL_MODES,
  type LatLng,
  type PaceRules,
  type Stay,
  type TravelMatrix,
  type TravelMode,
  type Trip,
  type Wish,
} from '../model';
import { estimateLeg } from './estimate';

export interface LegChoice {
  mode: TravelMode;
  durationSec: number;
  distanceM: number | null;
  estimated: boolean;
}

export interface SolverContext {
  rules: PaceRules;
  /** Allowed modes, walk always included, canonical order. */
  modes: TravelMode[];
  matrix: TravelMatrix;
  index: Map<string, number>;
  /** Matrix point key → coordinates, for estimated fallbacks. */
  locations: Map<string, LatLng>;
  cache: Map<string, LegChoice>;
}

export const stayPoint = (stayId: string): string => `stay:${stayId}`;

export function makeContext(
  trip: Pick<Trip, 'pace' | 'modes'>,
  stays: Stay[],
  wishes: Wish[],
  matrix: TravelMatrix,
): SolverContext {
  const index = new Map<string, number>();
  matrix.points.forEach((p, i) => {
    if (!index.has(p)) index.set(p, i);
  });
  const locations = new Map<string, LatLng>();
  for (const s of stays) locations.set(stayPoint(s.id), s.location);
  for (const w of wishes) if (w.place) locations.set(w.id, w.place.location);
  return {
    rules: PACE_RULES[trip.pace] ?? PACE_RULES.normal,
    modes: TRAVEL_MODES.filter((m) => m === 'walk' || trip.modes.includes(m)),
    matrix,
    index,
    locations,
    cache: new Map(),
  };
}

function cell(
  table: Partial<Record<TravelMode, Array<Array<number | null>>>>,
  mode: TravelMode,
  i: number,
  j: number,
): number | null {
  const v = table[mode]?.[i]?.[j];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Taxi time from a drive time: the drive plus the typical wait for pick-up. */
export function taxiSec(driveSec: number): number {
  return driveSec + TAXI_PICKUP_SEC;
}

/**
 * Seconds and metres for one mode between matrix indices. Taxi is derived
 * from the drive row (a matrix never has taxi rows); null = no route.
 */
export function modeSeconds(
  matrix: TravelMatrix,
  mode: TravelMode,
  i: number,
  j: number,
): { seconds: number; metres: number | null; estimated: boolean } | null {
  const row: TravelMode = mode === 'taxi' ? 'drive' : mode;
  const sec = cell(matrix.seconds, row, i, j);
  if (sec === null) return null;
  return {
    seconds: mode === 'taxi' ? taxiSec(sec) : sec,
    metres: cell(matrix.metres, row, i, j),
    estimated: matrix.estimated[row] ?? false,
  };
}

/** Choose the leg between two matrix points by the pace's mode rule. */
export function chooseLeg(ctx: SolverContext, from: string, to: string): LegChoice {
  if (from === to) return { mode: 'walk', durationSec: 0, distanceM: 0, estimated: false };
  const key = `${from}\u0000${to}`;
  const hit = ctx.cache.get(key);
  if (hit) return hit;
  const i = ctx.index.get(from);
  const j = ctx.index.get(to);
  let choice: LegChoice | null = null;
  if (i !== undefined && j !== undefined) {
    const of = (mode: TravelMode): LegChoice | null => {
      const m = modeSeconds(ctx.matrix, mode, i, j);
      return m ? { mode, durationSec: m.seconds, distanceM: m.metres, estimated: m.estimated } : null;
    };
    const walk = of('walk');
    if (walk && walk.durationSec <= ctx.rules.walkLimitSec) choice = walk;
    else {
      for (const mode of ctx.modes) {
        const c = of(mode);
        if (c && (!choice || c.durationSec < choice.durationSec)) choice = c;
      }
    }
  }
  if (!choice) choice = estimatedWalk(ctx.locations.get(from), ctx.locations.get(to));
  ctx.cache.set(key, choice);
  return choice;
}

/** A walk estimated from coordinates; zero when either end is unknown. */
export function estimatedWalk(a: LatLng | undefined | null, b: LatLng | undefined | null): LegChoice {
  if (!a || !b) return { mode: 'walk', durationSec: 0, distanceM: null, estimated: true };
  const e = estimateLeg(a, b, 'walk');
  return {
    mode: 'walk',
    durationSec: e.seconds,
    distanceM: e.metres,
    estimated: true,
  };
}

/**
 * The leg from an arbitrary position (the phone) to a point, estimated for
 * every allowed mode and chosen by the same walk-limit rule.
 */
export function legFromPosition(ctx: SolverContext, position: LatLng, to: string): LegChoice {
  const target = ctx.locations.get(to);
  if (!target) return { mode: 'walk', durationSec: 0, distanceM: null, estimated: true };
  const walk = estimateLeg(position, target, 'walk');
  if (walk.seconds <= ctx.rules.walkLimitSec) {
    return {
      mode: 'walk',
      durationSec: walk.seconds,
      distanceM: walk.metres,
      estimated: true,
    };
  }
  let best: LegChoice | null = null;
  for (const mode of ctx.modes) {
    const e = estimateLeg(position, target, mode);
    if (!best || e.seconds < best.durationSec) {
      best = {
        mode,
        durationSec: e.seconds,
        distanceM: e.metres,
        estimated: true,
      };
    }
  }
  return best as LegChoice;
}

/** Restrict a matrix to some points (in the given order); unknown points are skipped. */
export function sliceMatrix(matrix: TravelMatrix, points: string[]): TravelMatrix {
  const idx = points.map((p) => [p, matrix.points.indexOf(p)] as const).filter(([, i]) => i >= 0);
  const out: TravelMatrix = {
    points: idx.map(([p]) => p),
    seconds: {},
    metres: {},
    estimated: {},
  };
  for (const mode of TRAVEL_MODES) {
    const secs = matrix.seconds[mode];
    if (secs) out.seconds[mode] = idx.map(([, i]) => idx.map(([, j]) => secs[i]?.[j] ?? null));
    const metres = matrix.metres[mode];
    if (metres) out.metres[mode] = idx.map(([, i]) => idx.map(([, j]) => metres[i]?.[j] ?? null));
    if (matrix.estimated[mode] !== undefined) out.estimated[mode] = matrix.estimated[mode];
  }
  return out;
}
