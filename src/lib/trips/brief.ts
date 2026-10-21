// src/lib/trips/brief.ts
//
// v8: the brief — what the planner knows about a trip, each item labelled with
// where it came from (./decisions FactSource). Built from the trip, its
// stays, journeys, bookings, must-dos and profile, and the trip's stored
// provenance. PURE.
//
// CONTRACT STUB (2026-10-21): the full builder lands with the proposals
// work; this version already gives every caller the right shape.

import type { Booking, Stay, TransportSegment, Trip, TravellerProfile, Wish } from './model';
import type { BriefItem, Provenance, TripBrief } from './decisions';

export interface BriefInput {
  trip: Trip;
  stays: Stay[];
  wishes: Wish[];
  bookings: Booking[];
  transport: TransportSegment[];
  profile: TravellerProfile | null;
  provenance: Provenance;
  /** What the planner still needs (./prompt `missingInfo`). */
  missing: string[];
}

export function buildBrief(input: BriefInput): TripBrief {
  const p = (key: string) => input.provenance[key];
  const items: BriefItem[] = [
    {
      key: 'dates',
      kind: 'dates',
      label: `${input.trip.startDate} – ${input.trip.endDate}`,
      detail: null,
      origin: p('dates')?.source ?? 'you',
      note: p('dates')?.note ?? null,
      ref: p('dates')?.ref ?? null,
      editable: true,
    },
  ];
  return { items, assumed: items.filter((i) => i.origin === 'assumed').length, missing: input.missing };
}
