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
  PlannedDay,
  SolvedPlan,
  Stay,
  TravelMatrix,
  Trip,
  TripStatus,
  Wish,
} from './model';

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

export interface TripBundle {
  trip: Trip;
  stays: Stay[];
  wishes: Wish[];
  bookings: Booking[];
  plan: BundlePlan | null;
  matrices: Record<LocalDate, TravelMatrix>;
  /** v2: every point, for a simple offline pull-forward on the phone. */
  tripMatrix: TravelMatrix | null;
  /** v2: the planning conversation, last 50, oldest first. */
  messages: TripMessage[];
  /** v2: the city guide. */
  guide: TripGuide | null;
  etag: string;
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
  for (const s of day.stops) if (s.kind === 'wish' && s.wishId && !wanted.includes(s.wishId)) wanted.push(s.wishId);
  return sliceMatrix(matrix, wanted);
}

export function dayMatrices(matrix: TravelMatrix | null, plan: SolvedPlan | null): Record<LocalDate, TravelMatrix> {
  const out: Record<LocalDate, TravelMatrix> = {};
  if (!matrix || !plan) return out;
  for (const day of plan.days) out[day.date] = daySubMatrix(matrix, day);
  return out;
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
