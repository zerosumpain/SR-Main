// src/lib/trips/solver/types.ts
//
// The solver's input shapes, exactly as in the build contract
// (docs/superpowers/specs/2026-10-13-trips.md, "Solver API").

import type { Booking, LatLng, PlannedDay, Stay, TravelMatrix, Trip, Wish } from '../model';

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
