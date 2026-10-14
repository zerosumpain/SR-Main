// src/lib/trips/solver/fixtures/build.ts
//
// Small builders for solver fixtures and tests: a wish, its facts, a stay
// and a trip with sensible defaults, so a test states only what it is about.

import type { Facts, LatLng, Stay, Trip, Wish } from '../../model';
import { parseOpeningHours } from '../hours';

export function makeFacts(hours: string | null, extra: Partial<Facts> = {}): Facts {
  return {
    openingHoursText: hours,
    hours: parseOpeningHours(hours),
    closedDates: [],
    bookingRequired: null,
    bookAheadDays: null,
    bookingUrl: null,
    officialUrl: null,
    priceText: null,
    typicalVisitSec: null,
    summary: null,
    sources: [],
    checkedAt: null,
    depth: 'manual',
    unknown: [],
    ...extra,
  };
}

export function makeWish(
  id: string,
  title: string,
  location: LatLng,
  opts: {
    priority?: Wish['priority'];
    minutes?: number | null;
    hours?: string | null;
    sortHint?: number;
    facts?: Partial<Facts>;
  } & Partial<Omit<Wish, 'facts'>> = {},
): Wish {
  const { priority = 'must', minutes = 60, hours = '24/7', sortHint = 0, facts, ...rest } = opts;
  return {
    id,
    title,
    place: { name: title, location, osmId: null, address: null },
    priority,
    durationSec: minutes === null ? null : minutes * 60,
    partOfDay: 'any',
    fixedDate: null,
    fixedStartMin: null,
    locked: false,
    suggested: false,
    skipped: false,
    facts: makeFacts(hours, facts),
    note: null,
    sortHint,
    ...rest,
  };
}

export function makeStay(id: string, name: string, location: LatLng, fromDate: string, toDate: string): Stay {
  return {
    id,
    name,
    address: null,
    location,
    fromDate,
    toDate,
    checkInMin: null,
    checkOutMin: null,
  };
}

export function makeTrip(startDate: string, endDate: string, extra: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-test',
    ownerEmail: 'owner@example.com',
    title: 'Test trip',
    destination: 'Test',
    timeZone: 'Europe/Rome',
    startDate,
    endDate,
    pace: 'normal',
    modes: ['walk', 'transit'],
    status: 'planned',
    notes: null,
    ...extra,
  };
}
