// The trip and family context SR-Workflows' briefing composer reads from Main
// (`GET /api/platform/briefing/context`). The Workflows database role cannot
// read Main's trip and family tables, so Main answers with this summary.
//
// PURE: which trip is "today's", which of its stops fall today, how a journey
// reads, and the family block's counts. The reads are in ./context.server.

import { addDays, daysBetween } from '$lib/trips/booking';
import type { LocalDate, SolvedPlan, Stay, TransportSegment } from '$lib/trips/model';

export const DEFAULT_TZ = 'Europe/London';
/** How far ahead an upcoming trip is announced when none is under way. */
export const NEXT_TRIP_DAYS = 14;
export const LATEST_TEXT_MAX = 140;
export const LAST_FROM_MAX = 4;
export const TASKS_MAX = 6;
export const OVERNIGHT_MS = 24 * 3_600_000;

/** Statuses that take a trip out of the briefing whatever its dates. */
const GONE = new Set(['cancelled', 'canceled', 'archived', 'deleted']);
/** Lower wins when two trips cover the same day. */
const STATUS_RANK: Record<string, number> = { active: 0, planned: 1, draft: 2, done: 3 };

export interface BriefingTransport {
  kind: string;
  direction: string | null;
  carrier: string | null;
  number: string | null;
  from: string | null;
  to: string | null;
  departDate: string | null;
  departMin: number | null;
  arriveDate: string | null;
  arriveMin: number | null;
  status: string | null;
  delayMin: number | null;
}

export interface BriefingStop {
  title: string;
  kind: string;
  arriveMin: number | null;
}

export interface TripToday {
  id: string;
  title: string;
  destination: string;
  timeZone: string;
  startDate: string;
  endDate: string;
  dayIndex: number;
  dayCount: number;
  daysUntil: number;
  stay: { name: string; lat: number; lng: number } | null;
  todayStops: BriefingStop[];
  transports: BriefingTransport[];
}

export interface FamilyBlock {
  members: string[];
  messagesOvernight: number;
  lastFrom: string[];
  latestText: string | null;
  tasksOpen: Array<{ title: string; due: string | null; who: string | null }>;
}

export interface BriefingContext {
  generatedAt: string;
  trip: TripToday | null;
  nextTrip: TripToday | null;
  family: FamilyBlock | null;
}

/** The fields of a trip summary the choice reads. */
export interface TripCandidate {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  planVersion: number | null;
  updatedAt: string;
  /** How many journeys it has; filled for the trips that cover the day. */
  transportCount?: number;
}

/** A valid IANA zone, else the default. */
export function safeTimeZone(tz: string | null | undefined): string {
  const value = (tz ?? '').trim();
  if (!value) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TZ;
  }
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const live = (t: TripCandidate) => !GONE.has((t.status ?? '').toLowerCase()) && isDay(t.startDate) && isDay(t.endDate);

function preference(a: TripCandidate, b: TripCandidate): number {
  const rank = (t: TripCandidate) => STATUS_RANK[t.status] ?? 9;
  return (
    rank(a) - rank(b) ||
    Number(b.planVersion != null) - Number(a.planVersion != null) ||
    Number((b.transportCount ?? 0) > 0) - Number((a.transportCount ?? 0) > 0) ||
    (b.planVersion ?? 0) - (a.planVersion ?? 0) ||
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

/** Trips whose dates cover `today`, any live status — the candidates for `trip`. */
export function tripsCovering<T extends TripCandidate>(trips: readonly T[], today: LocalDate): T[] {
  return trips.filter((t) => live(t) && t.startDate <= today && today <= t.endDate);
}

/**
 * Today's trip: one whose dates cover today. When two overlap (a planned
 * duplicate beside the one under way) the active one wins, then one with a
 * plan, then one with journeys, then the newer plan and the latest edit.
 */
export function pickTodayTrip<T extends TripCandidate>(trips: readonly T[], today: LocalDate): T | null {
  return [...tripsCovering(trips, today)].sort(preference)[0] ?? null;
}

/** The soonest trip starting after today and within `NEXT_TRIP_DAYS`; never a finished one. */
export function pickNextTrip<T extends TripCandidate>(trips: readonly T[], today: LocalDate): T | null {
  const horizon = addDays(today, NEXT_TRIP_DAYS);
  const soon = trips.filter((t) => live(t) && t.status !== 'done' && t.startDate > today && t.startDate <= horizon);
  return soon.sort((a, b) => a.startDate.localeCompare(b.startDate) || preference(a, b))[0] ?? null;
}

/** Where today falls in the trip. Upcoming trips are day 0 with a countdown. */
export function tripDay(startDate: LocalDate, endDate: LocalDate, today: LocalDate): { dayIndex: number; dayCount: number; daysUntil: number } {
  const dayCount = Math.max(1, daysBetween(startDate, endDate) + 1);
  const until = daysBetween(today, startDate);
  if (until > 0) return { dayIndex: 0, dayCount, daysUntil: until };
  return { dayIndex: Math.min(dayCount, daysBetween(startDate, today) + 1), dayCount, daysUntil: 0 };
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Today's stops from a stored plan, in the plan's order. Tolerates any shape. */
export function stopsForDay(plan: SolvedPlan | null | undefined, day: LocalDate): BriefingStop[] {
  const days = Array.isArray((plan as { days?: unknown } | null)?.days) ? (plan as SolvedPlan).days : [];
  const today = days.find((d) => d && d.date === day);
  if (!today || !Array.isArray(today.stops)) return [];
  return today.stops
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      title: text(s.title) ?? '',
      kind: text(s.kind) ?? 'stop',
      arriveMin: finite(s.arriveMin),
    }))
    .filter((s) => s.title);
}

/** "Rome Fiumicino Airport (FCO)", the name or the code alone, or null. */
export function placeLabel(place: unknown): string | null {
  if (typeof place === 'string') return text(place);
  if (!place || typeof place !== 'object') return null;
  const p = place as { name?: unknown; code?: unknown };
  const name = text(p.name);
  const code = text(p.code);
  if (name && code) return name.includes(`(${code})`) ? name : `${name} (${code})`;
  return name ?? code;
}

/** One journey as the composer reads it. */
export function toBriefingTransport(segment: Partial<TransportSegment> | Record<string, unknown>): BriefingTransport {
  const t = segment as Record<string, unknown>;
  return {
    kind: text(t.kind) ?? 'transport',
    direction: text(t.direction),
    carrier: text(t.carrier),
    number: text(t.number),
    from: placeLabel(t.from),
    to: placeLabel(t.to),
    departDate: isDay(t.departDate) ? t.departDate : null,
    departMin: finite(t.departMin),
    arriveDate: isDay(t.arriveDate) ? t.arriveDate : null,
    arriveMin: finite(t.arriveMin),
    status: text(t.status),
    delayMin: finite(t.delayMin),
  };
}

/** Every journey, ordered by departure date then minute (undated last). */
export function orderTransports(list: readonly BriefingTransport[]): BriefingTransport[] {
  return [...list].sort(
    (a, b) =>
      (a.departDate ?? '9999').localeCompare(b.departDate ?? '9999') ||
      (a.departMin ?? Number.MAX_SAFE_INTEGER) - (b.departMin ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * The stay covering today: checked in on or before today and checking out
 * after it; else one whose last night ends today; else the first stay.
 */
export function stayForDay(stays: readonly Stay[], day: LocalDate): TripToday['stay'] {
  const usable = stays.filter((s) => s && text(s.name) && finite(s.location?.lat) != null && finite(s.location?.lng) != null);
  const pick =
    usable.find((s) => s.fromDate <= day && day < s.toDate) ??
    usable.find((s) => s.fromDate <= day && day <= s.toDate) ??
    usable[0];
  return pick ? { name: pick.name.trim(), lat: pick.location.lat, lng: pick.location.lng } : null;
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

export function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** The messages the family block counts. */
export interface FamilyMessageLike {
  fromEmail: string;
  fromName: string;
  body: string;
  createdAt: Date;
}

/**
 * The overnight message summary: messages (and replies) in the 24 hours
 * before `now` that the owner did not write, newest first.
 */
export function summariseMessages(
  messages: readonly FamilyMessageLike[],
  isOwner: (email: string) => boolean,
  now: Date,
): Pick<FamilyBlock, 'messagesOvernight' | 'lastFrom' | 'latestText'> {
  const since = now.getTime() - OVERNIGHT_MS;
  const recent = messages
    .filter((m) => m.createdAt.getTime() >= since && m.createdAt.getTime() <= now.getTime() && !isOwner(m.fromEmail))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const lastFrom: string[] = [];
  for (const m of recent) {
    const name = firstName(m.fromName);
    if (name && !lastFrom.includes(name)) lastFrom.push(name);
    if (lastFrom.length >= LAST_FROM_MAX) break;
  }
  return {
    messagesOvernight: recent.length,
    lastFrom,
    latestText: recent[0] ? clip(recent[0].body, LATEST_TEXT_MAX) : null,
  };
}

export interface FamilyTaskLike {
  title: string;
  deadline: string | null;
  assigneeEmail: string | null;
  status: string;
  createdAt: Date;
}

/** Open tasks, soonest deadline first (undated after), at most `TASKS_MAX`. */
export function openTasks(tasks: readonly FamilyTaskLike[], nameOf: (email: string) => string): FamilyBlock['tasksOpen'] {
  return tasks
    .filter((t) => t.status === 'open')
    .sort(
      (a, b) =>
        (a.deadline ?? '9999-99-99').localeCompare(b.deadline ?? '9999-99-99') ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .slice(0, TASKS_MAX)
    .map((t) => ({
      title: t.title,
      due: t.deadline ?? null,
      who: t.assigneeEmail ? firstName(nameOf(t.assigneeEmail)) || null : null,
    }));
}
