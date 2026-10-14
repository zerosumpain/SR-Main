// src/lib/trips/intake.ts
//
// Validation for everything a person or the phone sends: the trip intake, a
// stay, a wish and its edits, a booking, the phone's events and its replan
// request. Each parser takes `unknown` (a parsed JSON body) and returns either
// the clean value or a sentence to show. PURE.

import {
  TRAVEL_MODES,
  type BookingStatus,
  type LatLng,
  type LocalDate,
  type Observation,
  type OffPlanKind,
  type Pace,
  type PartOfDay,
  type PlannedDay,
  type Priority,
  type TravelMode,
  type TripEvent,
  type TripEventKind,
} from './model';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = <T>(error: string): Parsed<T> => ({ ok: false, error });

const PACES: Pace[] = ['relaxed', 'normal', 'packed'];
const PARTS: PartOfDay[] = ['morning', 'afternoon', 'evening', 'any'];
const PRIORITIES: Priority[] = ['must', 'nice'];
const BOOKING_STATUSES: BookingStatus[] = ['to-book', 'booked', 'cancelled'];
const EVENT_KINDS: TripEventKind[] = ['arrived', 'left', 'skipped', 'delayed', 'option-applied', 'stop-added'];

/** The longest trip the planner takes, days. */
export const MAX_TRIP_DAYS = 31;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : null;
}

export function isLocalDate(v: unknown): v is LocalDate {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function isTimeZone(v: unknown): v is string {
  if (typeof v !== 'string' || !v.includes('/')) return v === 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

function minute(v: unknown): number | null | undefined {
  if (v === null || v === '' || v === undefined) return v === undefined ? undefined : null;
  if (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v)) {
    const [h, m] = v.split(':').map(Number);
    return h < 24 && m < 60 ? h * 60 + m : undefined;
  }
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 24 * 60 ? n : undefined;
}

function latLng(v: unknown): LatLng | null {
  if (!isObj(v)) return null;
  const lat = Number(v.lat);
  const lng = Number(v.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function daysBetween(a: LocalDate, b: LocalDate): number {
  const p = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((p(b) - p(a)) / 86_400_000);
}

export interface TripInput {
  title: string;
  destination: string;
  timeZone: string;
  startDate: LocalDate;
  endDate: LocalDate;
  pace: Pace;
  modes: TravelMode[];
  notes: string | null;
}

export function parseTripInput(body: unknown): Parsed<TripInput> {
  if (!isObj(body)) return bad('Send the trip as JSON.');
  const destination = text(body.destination, 120);
  if (!destination) return bad('Where are you going?');
  const title = text(body.title, 120) ?? destination;
  if (!isTimeZone(body.timeZone)) return bad('Pick the time zone of the destination, e.g. Europe/Rome.');
  if (!isLocalDate(body.startDate) || !isLocalDate(body.endDate)) return bad('Give the first and last day as dates.');
  const span = daysBetween(body.startDate, body.endDate);
  if (span < 0) return bad('The last day is before the first.');
  if (span + 1 > MAX_TRIP_DAYS) return bad(`A trip can be at most ${MAX_TRIP_DAYS} days.`);
  const pace = PACES.includes(body.pace as Pace) ? (body.pace as Pace) : 'normal';
  const raw = Array.isArray(body.modes) ? body.modes : [];
  const modes = TRAVEL_MODES.filter((m) => m === 'walk' || raw.includes(m));
  return ok({
    title,
    destination,
    timeZone: body.timeZone as string,
    startDate: body.startDate,
    endDate: body.endDate,
    pace,
    modes,
    notes: text(body.notes, 2000),
  });
}

/**
 * The draft a trip starts as when it begins with an opening message: the
 * planner's first ops set the real destination and dates. Placeholder dates
 * four weeks out, three days long; the prompt tells the planner they are
 * placeholders (`NEW_TRIP`).
 */
export function draftTrip(today: LocalDate): TripInput {
  const p = (n: number) => {
    const [y, m, d] = today.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
  };
  return { title: 'New trip', destination: 'New trip', timeZone: 'Europe/London', startDate: p(28), endDate: p(30), pace: 'normal', modes: ['walk', 'transit'], notes: null };
}

export interface StayInput {
  name: string;
  address: string | null;
  location: LatLng;
  fromDate: LocalDate;
  toDate: LocalDate;
  checkInMin: number | null;
  checkOutMin: number | null;
}

export function parseStayInput(body: unknown, trip: { startDate: LocalDate; endDate: LocalDate }): Parsed<StayInput> {
  if (!isObj(body)) return bad('Send the stay as JSON.');
  const name = text(body.name, 120);
  if (!name) return bad('Name the place you are staying.');
  const location = latLng(body.location);
  if (!location) return bad('The stay needs a map position — search for it first.');
  const fromDate = isLocalDate(body.fromDate) ? body.fromDate : trip.startDate;
  let toDate: LocalDate;
  if (isLocalDate(body.toDate)) toDate = body.toDate;
  else if (Number.isInteger(Number(body.nights)) && Number(body.nights) > 0) {
    const [y, m, d] = fromDate.split('-').map(Number);
    toDate = new Date(Date.UTC(y, m - 1, d) + Number(body.nights) * 86_400_000).toISOString().slice(0, 10);
  } else return bad('How many nights?');
  if (daysBetween(fromDate, toDate) < 1) return bad('A stay is at least one night.');
  const checkInMin = minute(body.checkInMin) ?? null;
  const checkOutMin = minute(body.checkOutMin) ?? null;
  return ok({ name, address: text(body.address, 240), location, fromDate, toDate, checkInMin, checkOutMin });
}

export interface WishInput {
  title: string;
  priority: Priority;
  durationSec: number | null;
  partOfDay: PartOfDay;
  fixedDate: LocalDate | null;
  fixedStartMin: number | null;
  note: string | null;
}

/** A new wish. Only a title is required; everything else has a default. */
export function parseWishInput(body: unknown): Parsed<WishInput> {
  if (!isObj(body)) return bad('Send the wish as JSON.');
  const title = text(body.title, 160);
  if (!title) return bad('What do you want to do?');
  const patch = parseWishPatch(body);
  if (!patch.ok) return patch;
  const p = patch.value;
  return ok({
    title,
    priority: p.priority ?? 'nice',
    durationSec: p.durationSec ?? null,
    partOfDay: p.partOfDay ?? 'any',
    fixedDate: p.fixedDate ?? null,
    fixedStartMin: p.fixedStartMin ?? null,
    note: p.note ?? null,
  });
}

export interface WishPatch {
  title?: string;
  priority?: Priority;
  durationSec?: number | null;
  partOfDay?: PartOfDay;
  fixedDate?: LocalDate | null;
  fixedStartMin?: number | null;
  locked?: boolean;
  suggested?: false;
  skipped?: boolean;
  note?: string | null;
  sortHint?: number;
  place?: { name: string; location: LatLng; osmId: string | null; address: string | null } | null;
}

/** An edit to a wish: only the keys present change. `suggested` can only be cleared (accept). */
export function parseWishPatch(body: unknown): Parsed<WishPatch> {
  if (!isObj(body)) return bad('Send the change as JSON.');
  const out: WishPatch = {};
  if ('title' in body) {
    const t = text(body.title, 160);
    if (!t) return bad('A wish needs a title.');
    out.title = t;
  }
  if ('priority' in body) {
    if (!PRIORITIES.includes(body.priority as Priority)) return bad('Priority is must or nice.');
    out.priority = body.priority as Priority;
  }
  if ('durationSec' in body || 'durationMin' in body) {
    const raw = 'durationMin' in body ? Number(body.durationMin) * 60 : Number(body.durationSec);
    const empty = body.durationSec === null || body.durationMin === null || body.durationMin === '';
    if (empty) out.durationSec = null;
    else if (!Number.isFinite(raw) || raw < 5 * 60 || raw > 12 * 3600) return bad('A visit is between 5 minutes and 12 hours.');
    else out.durationSec = Math.round(raw);
  }
  if ('partOfDay' in body) {
    if (!PARTS.includes(body.partOfDay as PartOfDay)) return bad('Part of day is morning, afternoon, evening or any.');
    out.partOfDay = body.partOfDay as PartOfDay;
  }
  if ('fixedDate' in body) {
    if (body.fixedDate === null || body.fixedDate === '') out.fixedDate = null;
    else if (!isLocalDate(body.fixedDate)) return bad('That day is not a date.');
    else out.fixedDate = body.fixedDate;
  }
  if ('fixedStartMin' in body) {
    const m = minute(body.fixedStartMin);
    if (m === undefined) return bad('That time is not a time of day.');
    out.fixedStartMin = m;
  }
  if ('locked' in body) out.locked = body.locked === true;
  if ('suggested' in body) {
    if (body.suggested !== false) return bad('A suggestion can only be accepted.');
    out.suggested = false;
  }
  if ('skipped' in body) out.skipped = body.skipped === true;
  if ('note' in body) out.note = text(body.note, 1000);
  if ('place' in body) {
    if (body.place === null) out.place = null;
    else {
      const p = isObj(body.place) ? body.place : null;
      const location = latLng(p?.location);
      const name = text(p?.name, 160);
      if (!location || !name) return bad('A place needs a name and a map position.');
      const osmId = typeof p?.osmId === 'string' && /^(node|way|relation)\/\d+$/.test(p.osmId) ? p.osmId : null;
      out.place = { name, location, osmId, address: text(p?.address, 300) };
    }
  }
  if ('sortHint' in body) {
    const n = Number(body.sortHint);
    if (!Number.isInteger(n)) return bad('Order must be a whole number.');
    out.sortHint = n;
  }
  // A fixed time implies locked (model.ts).
  if (out.fixedStartMin !== undefined && out.fixedStartMin !== null) out.locked = true;
  return ok(out);
}

export interface BookingPatch {
  title?: string;
  status?: BookingStatus;
  reference?: string | null;
  url?: string | null;
  date?: LocalDate | null;
  startMin?: number | null;
  endMin?: number | null;
}

/** Only http(s) links are kept — a booking link is shown as an anchor. */
export function safeUrl(v: unknown): string | null {
  const t = text(v, 600);
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseBookingPatch(body: unknown): Parsed<BookingPatch> {
  if (!isObj(body)) return bad('Send the booking as JSON.');
  const out: BookingPatch = {};
  if ('title' in body) {
    const t = text(body.title, 160);
    if (!t) return bad('A booking needs a title.');
    out.title = t;
  }
  if ('status' in body) {
    if (!BOOKING_STATUSES.includes(body.status as BookingStatus)) return bad('Status is to-book, booked or cancelled.');
    out.status = body.status as BookingStatus;
  }
  if ('reference' in body) out.reference = text(body.reference, 120);
  if ('url' in body) {
    if (body.url && !safeUrl(body.url)) return bad('That link is not a web address.');
    out.url = safeUrl(body.url);
  }
  if ('date' in body) {
    if (body.date === null || body.date === '') out.date = null;
    else if (!isLocalDate(body.date)) return bad('That day is not a date.');
    else out.date = body.date;
  }
  for (const k of ['startMin', 'endMin'] as const) {
    if (k in body) {
      const m = minute(body[k]);
      if (m === undefined) return bad('That time is not a time of day.');
      out[k] = m;
    }
  }
  if (out.startMin != null && out.endMin != null && out.endMin <= out.startMin) return bad('The slot ends before it starts.');
  return ok(out);
}

export interface EventsBody {
  events: TripEvent[];
  basePlanVersion: number;
}

function isPlannedDay(v: unknown): v is PlannedDay {
  return isObj(v) && isLocalDate(v.date) && Array.isArray(v.stops) && Array.isArray(v.legs) && Array.isArray(v.warnings);
}

/** The phone's events. At most 200 per call; each needs a clientId, a kind and an ISO time. */
export function parseEventsBody(body: unknown): Parsed<EventsBody> {
  if (!isObj(body) || !Array.isArray(body.events)) return bad('Send { events, basePlanVersion }.');
  if (body.events.length > 200) return bad('At most 200 events at a time.');
  const base = Number(body.basePlanVersion ?? 0);
  if (!Number.isInteger(base) || base < 0) return bad('basePlanVersion must be a whole number.');
  const events: TripEvent[] = [];
  for (const raw of body.events) {
    if (!isObj(raw)) return bad('Each event is an object.');
    const clientId = text(raw.clientId, 100);
    if (!clientId) return bad('Each event needs a clientId.');
    if (!EVENT_KINDS.includes(raw.kind as TripEventKind)) return bad(`Unknown event kind for ${clientId}.`);
    const at = typeof raw.at === 'string' && !Number.isNaN(Date.parse(raw.at)) ? raw.at : null;
    if (!at) return bad(`Event ${clientId} needs an ISO time.`);
    const detail = isObj(raw.detail) ? raw.detail : null;
    if (
      raw.kind === 'option-applied' &&
      !isPlannedDay(detail?.day) &&
      !(Array.isArray(detail?.days) && detail.days.length > 0 && detail.days.length <= 40 && detail.days.every(isPlannedDay))
    ) {
      return bad(`Event ${clientId} needs detail.day (a planned day) or detail.days (planned days).`);
    }
    if (raw.kind === 'stop-added' && !text(detail?.title, 160)) return bad(`Event ${clientId} needs detail.title.`);
    events.push({
      clientId,
      kind: raw.kind as TripEventKind,
      stopId: text(raw.stopId, 200),
      wishId: text(raw.wishId, 100),
      at,
      detail,
    });
  }
  return ok({ events, basePlanVersion: base });
}

export interface ReplanBody {
  date: LocalDate;
  nowMin: number;
  position: LatLng | null;
  atStopId: string | null;
  doneStopIds: string[];
  /** v2: 'day' (default) = the day's options; 'trip' = whole-trip options + a narrative. */
  scope: 'day' | 'trip';
  observation: Observation | null;
}

const OFF_PLAN: OffPlanKind[] = ['behind', 'off-route', 'unplanned-stop', 'out-of-order', 'idle'];
const MOTION: Observation['motion'][] = ['walking', 'cycling', 'automotive', 'stationary', 'unknown'];

export function parseObservation(v: unknown): Parsed<Observation | null> {
  if (v === null || v === undefined) return ok(null);
  if (!isObj(v) || !OFF_PLAN.includes(v.kind as OffPlanKind)) return bad('observation.kind is not one the phone sends.');
  const sinceMin = Number(v.sinceMin);
  if (!Number.isInteger(sinceMin) || sinceMin < 0 || sinceMin >= 24 * 60 + 600) return bad('observation.sinceMin must be local minutes.');
  let place: Observation['place'] = null;
  if (v.place != null) {
    const p = isObj(v.place) ? v.place : null;
    const location = latLng(p?.location);
    if (!location) return bad('observation.place needs a location.');
    place = { name: text(p?.name, 160), location };
  }
  return ok({
    kind: v.kind as OffPlanKind,
    place,
    sinceMin,
    motion: MOTION.includes(v.motion as Observation['motion']) ? (v.motion as Observation['motion']) : 'unknown',
    stopId: text(v.stopId, 200),
  });
}

export function parseReplanBody(body: unknown): Parsed<ReplanBody> {
  if (!isObj(body)) return bad('Send { date, nowMin, position, atStopId, doneStopIds }.');
  if (!isLocalDate(body.date)) return bad('date must be a local date.');
  const nowMin = Number(body.nowMin);
  if (!Number.isInteger(nowMin) || nowMin < 0 || nowMin >= 24 * 60 + 600) return bad('nowMin must be local minutes.');
  const done = Array.isArray(body.doneStopIds) ? body.doneStopIds.filter((s): s is string => typeof s === 'string').slice(0, 200) : [];
  if (body.scope !== undefined && body.scope !== 'day' && body.scope !== 'trip') return bad("scope is 'day' or 'trip'.");
  const observation = parseObservation(body.observation);
  if (!observation.ok) return observation;
  return ok({
    scope: body.scope === 'trip' ? 'trip' : 'day',
    observation: observation.value,
    date: body.date,
    nowMin,
    position: body.position == null ? null : latLng(body.position),
    atStopId: text(body.atStopId, 200),
    doneStopIds: done,
  });
}
