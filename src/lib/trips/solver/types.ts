// src/lib/trips/solver/types.ts
//
// The solver's input shapes, exactly as in the build contract
// (docs/superpowers/specs/2026-10-13-trips.md, "Solver API").

import type {
  Booking,
  LatLng,
  PlannedDay,
  SolvedPlan,
  Stay,
  TransportSegment,
  TravelMatrix,
  Trip,
  Wish,
} from '../model';

export interface SolverInput {
  trip: Pick<Trip, 'id' | 'timeZone' | 'startDate' | 'endDate' | 'pace' | 'modes'> &
    Partial<Pick<Trip, 'dayLoads'>>;
  stays: Stay[];
  /** Suggested and skipped wishes are ignored. */
  wishes: Wish[];
  /** Status 'booked' with date + startMin = a hard window. */
  bookings: Booking[];
  /** Points are wish ids + `stay:<id>`. */
  matrix: TravelMatrix;
  /** v3: flights/trains there and back; points `transport:<id>:from|to` may be in the matrix. */
  transport?: TransportSegment[];
  /**
   * Stability: the current plan. Wishes keep their day when they still fit
   * there; only new or changed wishes, and what a day can no longer hold,
   * move. Absent = plan from scratch.
   */
  previous?: SolvedPlan;
}

export interface ReplanInput extends SolverInput {
  /** The day as currently planned. */
  day: PlannedDay;
  /** Local minutes now. */
  nowMin: number;
  /** Where the phone is. */
  position: LatLng | null;
  /** Stop the phone is at, if any. */
  atStopId: string | null;
  /** Visited or skipped already. */
  doneStopIds: string[];
}

export type RetimeInput = Omit<ReplanInput, 'day' | 'nowMin' | 'position' | 'atStopId' | 'doneStopIds'>;
