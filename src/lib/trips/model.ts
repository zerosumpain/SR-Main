// src/lib/trips/model.ts
//
// The trip planner's shared shapes: what the site stores, what the solver
// reads and writes, and what the phone receives. Pure types and a few
// constants, no I/O, so the solver, the server and the tests share one
// vocabulary. Spec: docs/superpowers/specs/2026-10-13-trips.md.
//
// THE RULE EVERYTHING HANGS ON: wishes, stays and bookings are CONSTRAINTS;
// the day-by-day schedule is a SOLVED, versioned plan and is never edited by
// hand. Every edit — a drag, a lock, "running late", "skip" — changes the
// constraints and re-plans.

/** A point. Always lat/lng objects on the wire — never an unlabelled pair. */
export interface LatLng {
  lat: number;
  lng: number;
}

export type TravelMode = 'walk' | 'cycle' | 'drive' | 'transit';
export const TRAVEL_MODES: readonly TravelMode[] = ['walk', 'cycle', 'drive', 'transit'];

export type Pace = 'relaxed' | 'normal' | 'packed';

export interface PaceRules {
  /** Day starts leaving the stay at this local time (minutes after midnight). */
  dayStartMin: number;
  /** Back at the stay by this local time. */
  dayEndMin: number;
  /** Slack added after every stop, seconds. */
  bufferSec: number;
  /** Walk any leg shorter than this, seconds; otherwise the fastest allowed mode. */
  walkLimitSec: number;
  /** Lunch window [start, end] in local minutes and its length, seconds. */
  lunch: { fromMin: number; toMin: number; durationSec: number };
  /** Dinner, or null to leave evenings free. */
  dinner: { fromMin: number; toMin: number; durationSec: number } | null;
}

export const PACE_RULES: Record<Pace, PaceRules> = {
  relaxed: {
    dayStartMin: 9 * 60 + 30,
    dayEndMin: 18 * 60 + 30,
    bufferSec: 15 * 60,
    walkLimitSec: 15 * 60,
    lunch: { fromMin: 12 * 60, toMin: 14 * 60 + 30, durationSec: 75 * 60 },
    dinner: null,
  },
  normal: {
    dayStartMin: 9 * 60,
    dayEndMin: 19 * 60,
    bufferSec: 10 * 60,
    walkLimitSec: 25 * 60,
    lunch: { fromMin: 12 * 60, toMin: 14 * 60 + 30, durationSec: 60 * 60 },
    dinner: null,
  },
  packed: {
    dayStartMin: 8 * 60,
    dayEndMin: 21 * 60,
    bufferSec: 5 * 60,
    walkLimitSec: 35 * 60,
    lunch: { fromMin: 12 * 60, toMin: 15 * 60, durationSec: 45 * 60 },
    dinner: { fromMin: 19 * 60, toMin: 21 * 60, durationSec: 75 * 60 },
  },
};

export type TripStatus = 'draft' | 'planned' | 'active' | 'done';
export type MemberRole = 'owner' | 'editor' | 'viewer';
export type Priority = 'must' | 'nice';
export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'any';

/** Local calendar date in the trip's time zone, `YYYY-MM-DD`. */
export type LocalDate = string;

export interface Trip {
  id: string;
  ownerEmail: string;
  title: string;
  destination: string;
  /** IANA zone, e.g. `Europe/Rome`. Every local time below is in this zone. */
  timeZone: string;
  startDate: LocalDate;
  endDate: LocalDate;
  pace: Pace;
  /** Modes the person is willing to use. Walk is always allowed. */
  modes: TravelMode[];
  status: TripStatus;
  notes: string | null;
}

/** Accommodation for a run of nights. Each day starts and ends here. */
export interface Stay {
  id: string;
  name: string;
  address: string | null;
  location: LatLng;
  /** First night (local date). */
  fromDate: LocalDate;
  /** Morning of departure (local date) — exclusive of the nights. */
  toDate: LocalDate;
  checkInMin: number | null;
  checkOutMin: number | null;
}

/** Opening hours for one weekday: local [open, close) minute ranges. */
export type DayHours = Array<{ openMin: number; closeMin: number }>;

/**
 * A researched fact sheet for a wish. Every field may be null (unknown) and
 * every sheet names its sources and when it was checked.
 */
export interface Facts {
  /** OSM `opening_hours` text, kept for display and re-parsing. */
  openingHoursText: string | null;
  /** Parsed hours by ISO weekday 1 (Mon) … 7 (Sun). Missing key = unknown, [] = closed. */
  hours: Partial<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, DayHours>> | null;
  /** Specific local dates it is closed (holidays). */
  closedDates: LocalDate[];
  bookingRequired: boolean | null;
  /** How far ahead it typically sells out, days. */
  bookAheadDays: number | null;
  /** Official seller only — never a reseller. */
  bookingUrl: string | null;
  officialUrl: string | null;
  priceText: string | null;
  /** Typical visit, seconds. */
  typicalVisitSec: number | null;
  summary: string | null;
  sources: Array<{ url: string; title: string | null }>;
  /** ISO timestamp the facts were last checked. */
  checkedAt: string | null;
  /** 'brief' = the one-search scan; 'deep' = after "look deeper". */
  depth: 'brief' | 'deep' | 'manual';
  /** Fields the scan could not answer. */
  unknown: string[];
}

export interface Wish {
  id: string;
  /** What the person typed or what the place is called. */
  title: string;
  /** Resolved place, null until research finds it. */
  place: { name: string; location: LatLng; osmId: string | null; address: string | null } | null;
  priority: Priority;
  /** Time to spend there, seconds; null = use facts.typicalVisitSec or a default. */
  durationSec: number | null;
  partOfDay: PartOfDay;
  /** Pin to a local date. */
  fixedDate: LocalDate | null;
  /** Pin to a local start time on that date (minutes). Implies locked. */
  fixedStartMin: number | null;
  /** Locked by the person — the solver must not move it off its day/time. */
  locked: boolean;
  /** Suggested by research and not yet accepted. Suggestions are never planned. */
  suggested: boolean;
  /** Skipped on the trip — kept for the record, not planned. */
  skipped: boolean;
  facts: Facts | null;
  note: string | null;
  sortHint: number;
}

export type BookingStatus = 'to-book' | 'booked' | 'cancelled';

export interface Booking {
  id: string;
  wishId: string | null;
  title: string;
  /** Local date + start minute; a booked slot is a hard time window. */
  date: LocalDate | null;
  startMin: number | null;
  endMin: number | null;
  reference: string | null;
  url: string | null;
  /** Drive file id for the ticket/confirmation. */
  documentId: string | null;
  status: BookingStatus;
}

// ── The solved plan ─────────────────────────────────────────────────────────

export type StopKind = 'wish' | 'meal' | 'stay';

export interface PlannedStop {
  /** Stable within a plan: the wish id, `meal:<date>:lunch`, `stay:<date>:start|end`. */
  id: string;
  kind: StopKind;
  wishId: string | null;
  title: string;
  location: LatLng | null;
  /** Local minutes after midnight. */
  arriveMin: number;
  departMin: number;
  /** Waiting before it opens, seconds (arrived early). */
  waitSec: number;
  locked: boolean;
  bookingId: string | null;
  warnings: string[];
}

export interface PlannedLeg {
  fromStopId: string;
  toStopId: string;
  mode: TravelMode;
  durationSec: number;
  distanceM: number | null;
  /** True when the time is a distance × factor guess, not a routed answer. */
  estimated: boolean;
  /** Simplified line for drawing, ≤ 300 points. Null until routed. */
  line: LatLng[] | null;
}

export interface PlannedDay {
  date: LocalDate;
  stayId: string | null;
  stops: PlannedStop[];
  /** legs[i] joins stops[i] → stops[i+1]. */
  legs: PlannedLeg[];
  warnings: string[];
}

export interface DroppedWish {
  wishId: string;
  reason: string;
}

/**
 * Travel times between every point the plan can visit, by mode. `points[i]`
 * is a wish id or `stay:<stayId>`; `seconds[mode][i][j]` is i → j, null when
 * that mode has no route. Shipped to the phone per day so it can re-time
 * without signal.
 */
export interface TravelMatrix {
  points: string[];
  seconds: Partial<Record<TravelMode, Array<Array<number | null>>>>;
  metres: Partial<Record<TravelMode, Array<Array<number | null>>>>;
  /** Which modes were routed vs estimated. */
  estimated: Partial<Record<TravelMode, boolean>>;
}

export interface SolvedPlan {
  days: PlannedDay[];
  dropped: DroppedWish[];
  warnings: string[];
  /** Lower is better; comparable only between plans of the same trip. */
  score: number;
}

export type PlanSource = 'site' | 'phone' | 'replan' | 'seed';

export interface PlanVersion {
  id: string;
  tripId: string;
  version: number;
  source: PlanSource;
  createdAt: string;
  /** sha256 of the canonical solver input — the same input gives the same plan. */
  inputHash: string;
  plan: SolvedPlan;
  /** Human list of what moved since the previous version. */
  changes: string[];
}

// ── What happened on the day (from the phone) ───────────────────────────────

export type TripEventKind =
  | 'arrived'
  | 'left'
  | 'skipped'
  | 'delayed'
  | 'option-applied'
  | 'stop-added';

export interface TripEvent {
  /** Idempotency key minted on the phone. */
  clientId: string;
  kind: TripEventKind;
  stopId: string | null;
  wishId: string | null;
  /** ISO timestamp it happened (phone clock). */
  at: string;
  /** delayed: seconds; option-applied: the option id; stop-added: a wish payload. */
  detail: Record<string, unknown> | null;
}

// ── Re-planning the rest of a day ───────────────────────────────────────────

export interface ReplanOption {
  id: string;
  /** "Push everything back 25 min", "Drop Spanish Steps (nice)", "Swap the next two". */
  label: string;
  kind: 'shift' | 'drop' | 'swap' | 'reorder';
  day: PlannedDay;
  /** Wishes this option drops from today. */
  dropped: string[];
  /** Minutes later the day ends than planned (negative = earlier). */
  endsLaterMin: number;
}
