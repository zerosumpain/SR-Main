// src/lib/trips/bundle.ts
//
// The phone's wire shapes (spec: "Phone wire contract") and the pure helpers
// behind them: the per-day travel matrix, the bundle's ETag and the canonical
// hash of a solver input. PURE apart from node:crypto's sha256.

import { createHash } from 'node:crypto';
import { sliceMatrix } from '$lib/trips/solver';
import type {
  Booking,
  LocalDate,
  TripGuide,
  TripMessage,
  TransportSegment,
  PlannedDay,
  SolvedPlan,
  Stay,
  TravelMatrix,
  Trip,
  TripStatus,
  TripAccess,
  TripSuggestion,
  DayFullness,
  PlaceImage,
  Wish,
} from './model';
import type { PackSummary, Proposal, Question, TripBrief } from './decisions';

export interface TripSummary {
  id: string;
  title: string;
  destination: string;
  timeZone: string;
  startDate: LocalDate;
  endDate: LocalDate;
  status: TripStatus;
  planVersion: number | null;
  updatedAt: string;
}

export interface BundlePlan {
  id: string;
  version: number;
  createdAt: string;
  plan: SolvedPlan;
  changes: string[];
}

/**
 * v5: the trip as the phone sees it — who created it as a family id and
 * name, never an email.
 */
export type WireTrip = Omit<Trip, 'ownerEmail'> & { createdById: string; createdByName: string };

export interface TripBundle {
  trip: WireTrip;
  stays: Stay[];
  wishes: Wish[];
  bookings: Booking[];
  plan: BundlePlan | null;
  matrices: Record<LocalDate, TravelMatrix>;
  /** v2: every point, for a simple offline pull-forward on the phone. */
  tripMatrix: TravelMatrix | null;
  /**
   * v2: the planning conversation, last 50, oldest first. v5: this caller's
   * own thread only, plus the plan-change events everyone sees.
   */
  messages: TripMessage[];
  /** v2: the city guide. */
  guide: TripGuide | null;
  /** v3: getting there and back — the first and last stage cards. */
  transport: TransportSegment[];
  /**
   * v5: the travellers ONLY — names, relations, ages, roster ids. No memory
   * text (preferences, constraints, history, sources) ever goes on the wire,
   * for anyone, the owner included.
   */
  profile: { travellers: BundleTraveller[] } | null;
  /** v5: what this caller may do (creator edits, parents approve, everyone suggests). */
  access: TripAccess;
  /** v5: pending suggestions and the last 20 decided, newest first. */
  suggestions: TripSuggestion[];
  /** v5: how full each day is. */
  fullness: Record<LocalDate, DayFullness>;
  /**
   * v7: photographs of the trip's places, by wish id — and of meal options,
   * by their OSM id — from Wikimedia Commons, each with its credit.
   */
  images?: Record<string, PlaceImage>;
  /**
   * v8: propose, research, ask (./decisions). The brief with where each fact
   * came from; the open questions this caller may answer (≤ 3) and those
   * answered in the last day; the open proposals this caller may act on
   * (editors only); the research pack's summary. Optional: a phone that
   * predates v8 ignores them.
   */
  brief?: TripBrief;
  questions?: Question[];
  answered?: Question[];
  proposals?: Proposal[];
  pack?: PackSummary;
  etag: string;
}

export interface BundleTraveller {
  name: string;
  relation: string | null;
  age: number | null;
  personId: string | null;
}

/** Matrix point id for a stay. */
export const stayPoint = (stayId: string) => `stay:${stayId}`;

/**
 * The sub-matrix for one day: that day's wish stops plus its stay, in the
 * order they appear in the day (stay first). Rows and columns are copied from
 * the trip-wide matrix; a point the trip matrix lacks is left out.
 */
export function daySubMatrix(matrix: TravelMatrix, day: PlannedDay): TravelMatrix {
  const wanted: string[] = [];
  if (day.stayId) wanted.push(stayPoint(day.stayId));
  for (const s of day.stops) {
    if (s.kind === 'wish' && s.wishId && !wanted.includes(s.wishId)) wanted.push(s.wishId);
    // v3: an arrival stop is the airport/station it lands at, a departure the one it leaves from.
    const t = s.kind === 'transport' ? /^transport:(.+):(arrive|depart)$/.exec(s.id) : null;
    if (t) {
      const point = `transport:${t[1]}:${t[2] === 'arrive' ? 'to' : 'from'}`;
      if (!wanted.includes(point)) wanted.push(point);
    }
  }
  return sliceMatrix(matrix, wanted);
}

export function dayMatrices(matrix: TravelMatrix | null, plan: SolvedPlan | null): Record<LocalDate, TravelMatrix> {
  const out: Record<LocalDate, TravelMatrix> = {};
  if (!matrix || !plan) return out;
  for (const day of plan.days) out[day.date] = wireMatrix(daySubMatrix(matrix, day));
  return out;
}

/**
 * A matrix as the phone reads it: points, seconds, metres and the per-mode
 * `estimated` flags. The server's per-cell `cellEstimated` stays off the wire
 * (the app decodes `estimated` as `[String: Bool]` and nothing more).
 */
export function wireMatrix(matrix: TravelMatrix): TravelMatrix;
export function wireMatrix(matrix: TravelMatrix | null): TravelMatrix | null;
export function wireMatrix(matrix: TravelMatrix | null): TravelMatrix | null {
  if (!matrix) return null;
  const { cellEstimated: _cells, ...wire } = matrix;
  return wire;
}

/** JSON with object keys sorted, so the same value always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A strong ETag over everything in the bundle but the tag itself. */
export function bundleEtag(bundle: Omit<TripBundle, 'etag'>): string {
  return `"${sha256(canonicalJson(bundle)).slice(0, 32)}"`;
}

/** True when an If-None-Match header names this tag (or `*`). */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === etag);
}
