// src/lib/trips/centre-stay.ts
//
// v8: "Stay: not known yet — planning from the centre", made true. With no
// stay the solver has nowhere to start or end a day, and the plan came out
// with lunch at 11:00 and dinner at 13:00. Until a real stay is named, the
// trip is solved (and shown) from a stand-in at the centre the research pack
// found — the middle of the city's best-known sights. It is never stored as a
// stay, and disappears the moment a real one is added. PURE.

import type { LatLng, Stay, Trip } from './model';

export const CENTRE_STAY_ID = 'centre';
export const CENTRE_STAY_NAME = 'The centre (no stay yet)';

/** The stays to solve with: the real ones, or the stand-in when there are none and a centre is known. */
export function withCentreStay(trip: Pick<Trip, 'startDate' | 'endDate'>, stays: Stay[], centre: LatLng | null | undefined): Stay[] {
  if (stays.length || !centre) return stays;
  return [{ id: CENTRE_STAY_ID, name: CENTRE_STAY_NAME, address: null, location: centre, fromDate: trip.startDate, toDate: trip.endDate, checkInMin: null, checkOutMin: null }];
}

export const isCentreStay = (s: Pick<Stay, 'id'>) => s.id === CENTRE_STAY_ID;
