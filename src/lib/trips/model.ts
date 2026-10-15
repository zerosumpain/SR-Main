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
import type { PlanOption } from './options';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * `taxi` (v2) is a drive leg the person does not drive: drive-matrix time plus
 * TAXI_PICKUP_SEC, and its guidance says how to get one in that city.
 */
export type TravelMode = 'walk' | 'cycle' | 'drive' | 'transit' | 'taxi';
export const TRAVEL_MODES: readonly TravelMode[] = ['walk', 'cycle', 'drive', 'transit', 'taxi'];
/** Typical wait for a taxi to arrive, added to the drive time. */
export const TAXI_PICKUP_SEC = 8 * 60;

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
  /**
   * v2.1: how full each day should be. 'light' ≈ 60% of the pace's active
   * time and ends 90 min earlier; 'full' lets the day run to its end. Missing = 'normal'.
   */
  dayLoads?: Partial<Record<LocalDate, DayLoad>>;
}

export type DayLoad = 'light' | 'normal' | 'full';

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
  /**
   * v2.1: this wish IS that day's lunch/dinner — the solver drops the automatic
   * meal stop and places this wish inside the meal window.
   */
  replacesMeal?: 'breakfast' | 'lunch' | 'dinner' | null;
  /** v2: what to know when you're there (model-written from facts). */
  guide?: StopGuide | null;
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

/** v3: 'transport' = a flight/train arrival or departure at the start or end of a day. */
export type StopKind = 'wish' | 'meal' | 'stay' | 'transport';

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
  /** v4: which part of the day this stop belongs to. Set by the solver. */
  stage?: DayStage;
  /**
   * v7: a lunch or dinner with no place yet — up to three real places near
   * where you will be, open then (./meals). Bundle only, never solved on.
   */
  mealOptions?: MealOption[];
}

/** v7: a real place to eat for a planned meal, from OpenStreetMap. */
export interface MealOption {
  /** Its OSM id, `node/123`. */
  id: string;
  name: string;
  kind: 'restaurant' | 'cafe';
  /** "Italian, pizza" — from OSM's cuisine tag; null when not on record. */
  cuisine: string | null;
  place: { name: string; location: LatLng; osmId: string | null; address: string | null };
  /** Minutes on foot from the stop before (straight-line estimate). */
  walkMin: number;
  walkFrom: string;
  /** "Open 12:00–15:00" that day; null when its hours are not on record. */
  openText: string | null;
  /** True when its own hours say it is open for the meal. */
  openKnown: boolean;
  website: string | null;
  phone: string | null;
  /** Dietary tags it carries that the family asked for ("vegetarian"). */
  diet: string[];
  outdoorSeating: boolean;
  wheelchair: boolean | null;
  wikidata: string | null;
  /** One line: what, how far, when it is open. */
  why: string;
  source: 'OpenStreetMap';
}

/**
 * v7: a photograph of a place, from Wikimedia Commons by its Wikidata entry
 * — free to show with its credit and licence, which always travel with it.
 */
export interface PlaceImage {
  /** A ~800 px wide JPEG/PNG on upload.wikimedia.org. */
  url: string;
  width: number | null;
  height: number | null;
  /** The author, plain text ("Jane Smith"); null when Commons has none. */
  credit: string | null;
  /** "CC BY-SA 4.0", "Public domain". */
  license: string | null;
  /** The file's Commons page, for the credit link. */
  sourceUrl: string;
  /** The Wikidata entry it came from, `Q123`. */
  wikidata: string;
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
  /** v2: how to actually do this leg. Null until guidance has been generated. */
  guidance?: LegGuidance | null;
  /** v5: walk / public transport / taxi times for this leg, for the phone's mode picker (bundle only). */
  alternatives?: LegAlternative[];
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
  /** Which modes were routed vs estimated (true = at least one cell estimated). */
  estimated: Partial<Record<TravelMode, boolean>>;
  /**
   * Server only, never on the wire (./bundle `wireMatrix`): for a mode that
   * is partly routed, which cells were estimated (1) or routed (0), aligned
   * with `seconds`, so each leg says truly whether it was routed. Absent =
   * the mode's `estimated` flag holds for every cell.
   */
  cellEstimated?: Partial<Record<TravelMode, Array<Array<0 | 1>>>>;
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

// ── v2: guidance, the planning conversation, going off-plan ─────────────────

/** A link the phone can open (URL, `tel:`, or an app's universal link). */
export interface GuideLink {
  label: string;
  url: string;
}

/**
 * How to do one leg, written for someone standing at the start of it.
 * Walking: `steps` are short directions; the route is the leg's `line`.
 * Transit: `transit` names the lines and stops. Taxi: `booking` says how to
 * get one (rank, app, phone) with links. Model-written from routed data and
 * the trip's `TripGuide`; `source` says which.
 */
export interface LegGuidance {
  /** "12 min walk via Via del Corso" / "Bus 64 from Largo Argentina, 4 stops". */
  summary: string;
  steps: string[];
  transit: Array<{
    line: string;
    vehicle: 'bus' | 'tram' | 'metro' | 'train' | 'ferry' | 'other';
    fromStop: string;
    toStop: string;
    stops: number | null;
    /** Local minutes of the next few departures, when known. */
    departuresMin: number[];
  }> | null;
  booking: { how: string; links: GuideLink[]; phone: string | null } | null;
  /** "Buy a BIT ticket at a tabacchi before boarding", "Validate on board". */
  tips: string[];
  costText: string | null;
  source: 'router' | 'model' | 'mixed';
  generatedAt: string;
}

/** What to know at a stop: entry, tickets, dress code, what not to miss. */
export interface StopGuide {
  summary: string;
  tips: string[];
  links: GuideLink[];
  generatedAt: string;
}

/** City-level know-how, made once per trip and reused by every leg's guidance. */
export interface TripGuide {
  gettingAround: string;
  taxi: { how: string; links: GuideLink[]; phone: string | null } | null;
  transitTickets: string | null;
  tips: string[];
  generatedAt: string;
  /** v7: the city primer — customs, money, a few words, safety (./guidance `readPrimer`). */
  primer?: CityPrimer | null;
  /** v7: the neighbourhoods the trip's places are in, each with its feel in a line. */
  neighbourhoods?: Neighbourhood[];
}

/** v7: what a visitor should know before arriving, written from search results and stable facts. */
export interface CityPrimer {
  /** "Churches ask for covered shoulders and knees." ≤ 5. */
  customs: string[];
  /** Cash or card, tipping, in a sentence or two. */
  money: string | null;
  /** A few words of the language: ≤ 8, the local phrase and what it means. */
  phrases: Array<{ local: string; meaning: string }>;
  /** Plain, proportionate: pickpockets on the 64 bus, not a list of fears. */
  safety: string | null;
  sources: Array<{ url: string; title: string | null }>;
}

/** v7: an area of the city the trip goes to, and which of its places are there. */
export interface Neighbourhood {
  name: string;
  /** Its feel, in one line. */
  line: string;
  /** Titles of the trip's places in it. */
  places: string[];
}

/**
 * The planning conversation. The trip is developed by talking to a model; the
 * forms are a VIEW of the constraints the conversation sets. A form edit is
 * also logged here (role 'event') so the model always sees what changed.
 */
export interface TripMessage {
  id: string;
  role: 'user' | 'assistant' | 'event';
  text: string;
  /** Operations the assistant applied (or a form edit recorded as ops). */
  ops: TripOp[];
  /** Plan version after this message, if it changed the plan. */
  planVersion: number | null;
  /** Where it was said. */
  surface: 'site' | 'phone';
  createdAt: string;
  /** v3: what the planner looked up for this reply (assistant messages). */
  research?: ResearchStep[];
}

export interface WishDraft {
  title: string;
  /** A place name to resolve (OSM). */
  placeQuery: string | null;
  priority: Priority;
  durationMin: number | null;
  partOfDay: PartOfDay;
  fixedDate: LocalDate | null;
  fixedStartMin: number | null;
  note: string | null;
  replacesMeal?: 'breakfast' | 'lunch' | 'dinner' | null;
  /**
   * v7: a place already found on the map (a meal option, a nearby idea) —
   * kept only on the phone's suggestion route and the server's own approval
   * of it, never from a model's op: a model's place is a query to resolve.
   */
  place?: { name: string; location: LatLng; osmId: string | null; address: string | null } | null;
}

/**
 * The only way the model changes a trip. Applied server-side in order,
 * validated, then the trip re-solves once. Ids refer to existing rows.
 */
export type TripOp =
  | { op: 'setTrip'; fields: Partial<Pick<Trip, 'title' | 'destination' | 'timeZone' | 'startDate' | 'endDate' | 'pace' | 'modes' | 'notes' | 'dayLoads'>> }
  | { op: 'addStay'; name: string; placeQuery: string; fromDate: LocalDate; toDate: LocalDate; checkInMin: number | null; checkOutMin: number | null }
  | { op: 'updateStay'; id: string; fields: Partial<Pick<Stay, 'name' | 'fromDate' | 'toDate' | 'checkInMin' | 'checkOutMin'>> & { placeQuery?: string } }
  | { op: 'removeStay'; id: string }
  | { op: 'addWish'; wish: WishDraft }
  | { op: 'updateWish'; id: string; fields: Partial<WishDraft> & { locked?: boolean; skipped?: boolean; suggested?: boolean } }
  | { op: 'removeWish'; id: string }
  | { op: 'addBooking'; booking: Omit<Booking, 'id'> }
  | { op: 'updateBooking'; id: string; fields: Partial<Omit<Booking, 'id'>> }
  | { op: 'research'; wishIds: string[]; depth: 'brief' | 'deep' }
  | { op: 'suggestNearby'; near: string | null; theme: string | null }
  | { op: 'addTransport'; segment: Omit<TransportSegment, 'id'> }
  | { op: 'updateTransport'; id: string; fields: Partial<Omit<TransportSegment, 'id'>> }
  | { op: 'removeTransport'; id: string }
  /** Save a LASTING preference the person stated to JKAI memory (owner-confirmed in the reply). */
  | { op: 'remember'; text: string; category: 'preferences' | 'people' | 'health' | 'places' }
  | { op: 'updateProfile'; profile: Partial<Omit<TravellerProfile, 'gatheredAt'>> };

/** One turn's answer from the planner. */
export interface ConverseResult {
  reply: string;
  applied: TripOp[];
  /** Ops the model proposed that were rejected, with why. */
  rejected: Array<{ op: TripOp; reason: string }>;
  /** Short follow-up questions the UI can offer as buttons. */
  quickReplies: string[];
  planVersion: number | null;
  changes: string[];
  /** v3: what the planner looked up this turn. */
  research?: ResearchStep[];
  /** v7: choices offered for an open question, each checked against its day (./options). */
  options?: PlanOption[];
}

/** What the phone saw that made it think the person is off the plan. */
export type OffPlanKind = 'behind' | 'off-route' | 'unplanned-stop' | 'out-of-order' | 'idle';

export interface Observation {
  kind: OffPlanKind;
  /** Where they are dwelling, if somewhere (reverse-geocoded on the phone). */
  place: { name: string | null; location: LatLng } | null;
  /** Local minute the condition started. */
  sinceMin: number;
  motion: 'walking' | 'cycling' | 'automotive' | 'stationary' | 'unknown';
  /** A later stop they reached early (out-of-order). */
  stopId: string | null;
}

/**
 * A whole-trip re-plan from now. `days` are today and every later day; earlier
 * days are unchanged. Server-only (needs solveTrip); the phone falls back to
 * replanDay offline.
 */
export interface TripReplanOption {
  id: string;
  label: string;
  kind: 'carry-on' | 'resolve-rest' | 'pull-forward' | 'stay-here';
  days: PlannedDay[];
  dropped: string[];
  /** Wishes moved to a different day than before, with where to. */
  moved: Array<{ wishId: string; from: LocalDate | null; to: LocalDate }>;
  /** One or two plain sentences: why this option. Model-written when online. */
  explanation: string;
}

// ── v3: what the planner already knows, getting there and back, its own research ──

/**
 * A flight, train or similar that brings the person to, from or between
 * places on the trip. The solver uses it to frame days: the arrival day
 * starts after `arrive` + exit time + transfer; the departure day ends at
 * `depart` − check-in lead − transfer.
 */
export interface TransportSegment {
  id: string;
  kind: 'flight' | 'train' | 'coach' | 'ferry' | 'car';
  direction: 'outbound' | 'return' | 'internal';
  carrier: string | null;
  /** e.g. "LS1235", "FR8346". */
  number: string | null;
  from: { name: string; code: string | null; location: LatLng | null; timeZone: string };
  to: { name: string; code: string | null; location: LatLng | null; timeZone: string };
  /** Local to `from.timeZone`. */
  departDate: LocalDate;
  departMin: number;
  /** Local to `to.timeZone`. */
  arriveDate: LocalDate;
  arriveMin: number;
  /**
   * How sure we are of the times. 'stated' = the person said; 'researched' =
   * found online (it has sources); 'estimated' = the planner's own estimate
   * from the usual journey time, nothing found; 'live' = a status feed on the day.
   */
  confidence: 'stated' | 'researched' | 'estimated' | 'live';
  /** Live status when known: delays move the arrival day's start. */
  status: 'scheduled' | 'delayed' | 'departed' | 'landed' | 'cancelled' | null;
  /** Minutes late per the latest status, when known. */
  delayMin: number | null;
  bookingRef: string | null;
  sources: Array<{ url: string; title: string | null }>;
  checkedAt: string | null;
}

/** Minutes from landing to leaving the airport, and arriving before departure. */
export const TRANSPORT_LEADS: Record<TransportSegment['kind'], { exitMin: number; checkInLeadMin: number }> = {
  flight: { exitMin: 40, checkInLeadMin: 120 },
  train: { exitMin: 10, checkInLeadMin: 20 },
  coach: { exitMin: 10, checkInLeadMin: 15 },
  ferry: { exitMin: 30, checkInLeadMin: 60 },
  car: { exitMin: 0, checkInLeadMin: 0 },
};

/**
 * What the planner already knows about the people travelling, gathered from
 * the owner's JKAI memory, knowledge search and the family roster. A snapshot
 * on the trip so the model sees it every turn and the owner can see and
 * correct it. Every item names where it came from.
 */
export interface TravellerProfile {
  travellers: Array<{ name: string; relation: string | null; notes: string[]; /** v5: age in years when known. */ age?: number | null; /** v5: family roster id when the traveller is a family member. */ personId?: string | null }>;
  /** "Prefers walking to taxis", "Vegetarian", "Hates early starts", "Likes a long lunch". */
  preferences: Array<{ text: string; source: 'memory' | 'knowledge' | 'family' | 'conversation'; ref: string | null }>;
  /** Hard constraints: dietary, mobility, health. */
  constraints: Array<{ text: string; source: 'memory' | 'knowledge' | 'family' | 'conversation'; ref: string | null }>;
  /** Past trips or places that tell us something. */
  history: string[];
  gatheredAt: string;
}

/** One thing the planner looked up during a turn, shown under its reply. */
export interface ResearchStep {
  tool: string;
  /** Plain words: "Looked up LS1235 Newcastle → Rome on 27 Oct". */
  summary: string;
  sources: Array<{ url: string; title: string | null }>;
}

// ── v4: the day in stages (studio view) ─────────────────────────────────────

/**
 * Every day is shown as four stages, each with its own look:
 * breakfast & morning, lunch, afternoon, dinner & evening. The solver sets
 * `PlannedStop.stage`; both the site studio and the phone group by it.
 * Travel (transport, transfers, bag drops) belongs to the stage it falls in.
 */
export type DayStage = 'morning' | 'lunch' | 'afternoon' | 'evening';
export const DAY_STAGES: readonly DayStage[] = ['morning', 'lunch', 'afternoon', 'evening'];
export const DAY_STAGE_LABEL: Record<DayStage, string> = {
  morning: 'Breakfast & morning',
  lunch: 'Lunch',
  afternoon: 'Afternoon',
  evening: 'Dinner & evening',
};

// ── v5: family trips, suggestions, how full a day is, leg alternatives ──────

/** What the caller may do with a trip. Sent on every phone bundle. */
export interface TripAccess {
  /** Created the trip: edits freely. */
  canEdit: boolean;
  /** A parent in the family: approves or rejects suggestions (and may edit). */
  canApprove: boolean;
  /** Any family member: may suggest something for a slot. */
  canSuggest: boolean;
  role: 'creator' | 'parent' | 'member';
}

export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/** A family member's proposal for a slot, waiting for a parent. */
export interface TripSuggestion {
  id: string;
  tripId: string;
  /** Family roster id + display name of who suggested it. Never an email on the wire. */
  byId: string;
  byName: string;
  date: LocalDate;
  stage: DayStage;
  wish: WishDraft;
  /** Why they suggest it, and the fit line from the idea check when it came from "Make a suggestion". */
  note: string | null;
  fitText: string | null;
  status: SuggestionStatus;
  decidedById: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** How full a day is: active (non-meal, non-free) minutes against the day's capacity. */
export interface DayFullness {
  activeMin: number;
  capacityMin: number;
  /** 0–100+, rounded. Over 100 = overfull. */
  pct: number;
  band: 'empty' | 'light' | 'balanced' | 'full' | 'overfull';
}

/** One way of doing a leg, for the phone's mode picker. */
export interface LegAlternative {
  mode: TravelMode;
  durationSec: number;
  estimated: boolean;
}
