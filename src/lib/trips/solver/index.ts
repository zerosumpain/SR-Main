// src/lib/trips/solver/index.ts
//
// The deterministic trip solver: same input, same plan. No I/O, no clock,
// no randomness; ties break on ids. Contract:
// docs/superpowers/specs/2026-10-13-trips.md ("Solver API").

import type { PlannedDay, ReplanOption, SolvedPlan, TripReplanOption } from '../model';
import { solveTrip as solveTripImpl } from './plan';
import { replanTrip as replanTripImpl, type TripReplanInput } from './trip';
import { replanDay as replanDayImpl, retimeDay as retimeDayImpl } from './replan';
import type { ReplanInput, RetimeInput, SolverInput } from './types';

export type { SolverInput, ReplanInput, RetimeInput } from './types';
export { stayFor } from './plan';
export { stageOf, mealOfStop, withStages, STAGE_TIMES } from './stages';
export { solverRules, BREAKFAST } from './rules';
export type { TripReplanInput } from './trip';
export { pullForwardCandidates, pullForwardDay, PULL_FORWARD_WALK_SEC } from './trip';
export { taxiSec, modeSeconds, chooseLeg, legFromPosition, makeContext } from './matrix';

/** Plan the whole trip. */
export function solveTrip(input: SolverInput): SolvedPlan {
  return solveTripImpl(input);
}

/** Up to three whole-trip options from now when the person is off the plan (server-side). */
export function replanTrip(input: TripReplanInput): TripReplanOption[] {
  return replanTripImpl(input);
}

/** Up to three ways to carry on from now, best first. */
export function replanDay(input: ReplanInput): ReplanOption[] {
  return replanDayImpl(input);
}

/** Re-time a day from `fromIndex`, setting off towards that stop at `startMin`. */
export function retimeDay(
  day: PlannedDay,
  fromIndex: number,
  startMin: number,
  input: RetimeInput,
): PlannedDay {
  return retimeDayImpl(day, fromIndex, startMin, input);
}

export { estimateMatrix, estimateLeg, haversineM } from './estimate';
export { parseOpeningHours, windowsOn } from './hours';
export { sliceMatrix } from './matrix';
export { isoWeekday, dayLabel, fmtMin } from './calendar';
