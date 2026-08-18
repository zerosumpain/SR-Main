// Health Auto Export (v2) workout payload -> our activity/track/series rows.
//
// Pure mapping: no DB, no clock, no randomness. Everything the ingest endpoint
// needs to decide is decided here, so the whole contract is unit-testable
// against a captured payload.

import { createHash } from 'node:crypto';
import { encodePolyline } from '$lib/health/polyline';
import {
  decimateTrack,
  elevationDelta,
  trackBounds,
  trackDistanceM,
  type Bounds,
  type TrackPoint,
} from './track';

// ——— Raw payload shapes (only the fields we read) ———————————————————

/** HAE reports every measurement as a value plus its unit. Never assume the unit. */
export interface HaeQuantity {
  qty?: number;
  units?: string;
}

export interface HaeRoutePoint {
  /** Workouts v1 dialect. */
  lat?: number;
  lon?: number;
  /** Workouts v2 dialect — the same coordinates spelt out in full. */
  latitude?: number;
  longitude?: number;
  altitude?: number;
  timestamp?: string;
  /** v2 also sends course/accuracy/speed fields we do not read. */
  [key: string]: unknown;
}

/**
 * Coordinates of one route point, whichever dialect it arrived in: HAE's
 * Workouts v1 says `lat`/`lon`, v2 says `latitude`/`longitude`, and real
 * phones send v2 while the documentation examples are mostly v1. Returns null
 * unless a finite, in-range pair is present.
 */
export function routePointCoords(
  p: HaeRoutePoint | null | undefined,
): { lat: number; lon: number } | null {
  if (!p || typeof p !== 'object') return null;
  const lat = typeof p.lat === 'number' ? p.lat : p.latitude;
  const lon = typeof p.lon === 'number' ? p.lon : p.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export interface HaeSample {
  date?: string;
  qty?: number;
  Avg?: number;
  units?: string;
}

export interface HaeWorkout {
  id?: string;
  name?: string;
  start?: string;
  end?: string;
  duration?: number | HaeQuantity;
  distance?: HaeQuantity;
  elevationUp?: HaeQuantity;
  elevationDown?: HaeQuantity;
  activeEnergyBurned?: HaeQuantity;
  totalEnergy?: HaeQuantity;
  intensity?: HaeQuantity;
  temperature?: HaeQuantity;
  humidity?: HaeQuantity;
  heartRateData?: HaeSample[];
  heartRateRecovery?: HaeSample[];
  stepCadence?: HaeSample[];
  speed?: HaeSample[];
  route?: HaeRoutePoint[];
  [key: string]: unknown;
}

// ——— Mapped output ————————————————————————————————————————————————

export interface MappedActivity {
  id: string;
  source: 'apple';
  externalId: string;
  name: string;
  activityType: string;
  rawType: string | null;
  startDate: number;
  endDate: number;
  startDateLocal: string;
  timezone: string | null;
  distanceM: number | null;
  durationS: number;
  activeDurationS: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  activeEnergyKj: number | null;
  totalEnergyKj: number | null;
  avgPaceSPerKm: number | null;
  avgCadence: number | null;
  hasTrack: boolean;
  metadata: Record<string, unknown> | null;
}

export interface MappedTrack {
  coordinates: TrackPoint[];
  pointCount: number;
  bounds: Bounds;
  polyline: string;
  distanceM: number;
}

export interface MappedSeries {
  metric: string;
  units: string;
  sampleCount: number;
  samples: [number, number][];
}

export interface MappedWorkout {
  activity: MappedActivity;
  track: MappedTrack | null;
  series: MappedSeries[];
}

// ——— Dates ————————————————————————————————————————————————————————
// Parsing lives in hae-dates.ts (a dependency-free leaf); re-exported here so
// existing callers keep their import path.

import { parseHaeDate, extractOffset } from './hae-dates';
export { parseHaeDate, extractOffset };

// ——— Units ————————————————————————————————————————————————————————

const DISTANCE_TO_M: Record<string, number> = {
  m: 1,
  km: 1000,
  mi: 1609.344,
  ft: 0.3048,
  yd: 0.9144,
};

const ENERGY_TO_KJ: Record<string, number> = {
  kj: 1,
  j: 0.001,
  kcal: 4.184,
  cal: 0.004184,
  ical: 4.184, // HAE writes "kcal" as "Cal" in some locales
};

function quantity(q: unknown): { qty: number; units: string } | null {
  if (typeof q === 'number') return Number.isFinite(q) ? { qty: q, units: '' } : null;
  if (!q || typeof q !== 'object') return null;
  const { qty, units } = q as HaeQuantity;
  if (typeof qty !== 'number' || !Number.isFinite(qty)) return null;
  return { qty, units: (units ?? '').trim().toLowerCase() };
}

/** Convert a HAE distance to metres, honouring whatever unit the phone was set to. */
export function toMetres(q: unknown, assume: keyof typeof DISTANCE_TO_M = 'km'): number | null {
  const parsed = quantity(q);
  if (!parsed) return null;
  const factor = DISTANCE_TO_M[parsed.units] ?? DISTANCE_TO_M[assume];
  return parsed.qty * factor;
}

/** Convert a HAE energy to kilojoules. Apple's "Cal" is a kilocalorie. */
export function toKilojoules(q: unknown): number | null {
  const parsed = quantity(q);
  if (!parsed) return null;
  const factor = ENERGY_TO_KJ[parsed.units] ?? ENERGY_TO_KJ.kj;
  return parsed.qty * factor;
}

// ——— Activity types ——————————————————————————————————————————————

// Apple's workout names, lowercased. Anything unmatched keeps its raw label
// and lands in 'other' — never guessed at, never dropped.
const TYPE_MAP: Array<[RegExp, string]> = [
  [/trail\s*run/, 'trail_run'],
  [/\brun/, 'run'],
  [/mountain\s*bik|\bmtb\b/, 'mtb'],
  [/cycl|biking|\bbike\b|\bride\b/, 'ride'],
  [/hik/, 'hike'],
  [/walk/, 'walk'],
  [/swim/, 'swim'],
];

export function normaliseActivityType(name: string | undefined | null): string {
  if (!name) return 'other';
  const n = name.toLowerCase();
  for (const [pattern, type] of TYPE_MAP) {
    if (pattern.test(n)) return type;
  }
  return 'other';
}

/** Types that carry a GPS trace and belong on the map surfaces. */
export const OUTDOOR_TYPES = new Set(['run', 'trail_run', 'ride', 'mtb', 'hike', 'walk']);

// ——— Series ————————————————————————————————————————————————————————

function mapSeries(
  samples: HaeSample[] | undefined,
  metric: string,
  defaultUnits: string,
  startDate: number,
): MappedSeries | null {
  if (!Array.isArray(samples) || !samples.length) return null;

  const points: [number, number][] = [];
  let units = defaultUnits;

  for (const s of samples) {
    const value = s?.qty ?? s?.Avg;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const at = parseHaeDate(s?.date);
    if (at == null) continue;
    if (s?.units) units = s.units;
    points.push([at - startDate, value]);
  }

  if (!points.length) return null;
  points.sort((a, b) => a[0] - b[0]);
  return { metric, units, sampleCount: points.length, samples: points };
}

function seriesStats(series: MappedSeries | null): { avg: number | null; max: number | null } {
  if (!series?.samples.length) return { avg: null, max: null };
  let sum = 0;
  let max = -Infinity;
  for (const [, v] of series.samples) {
    sum += v;
    if (v > max) max = v;
  }
  return { avg: Math.round(sum / series.samples.length), max: Math.round(max) };
}

// ——— Track ————————————————————————————————————————————————————————

function mapTrack(route: HaeRoutePoint[] | undefined, startDate: number): MappedTrack | null {
  if (!Array.isArray(route) || route.length < 2) return null;

  const raw: TrackPoint[] = [];
  for (const p of route) {
    const coords = routePointCoords(p);
    if (!coords) continue;
    const at = parseHaeDate(p?.timestamp);
    raw.push([
      coords.lon,
      coords.lat,
      typeof p.altitude === 'number' && Number.isFinite(p.altitude) ? p.altitude : null,
      at == null ? 0 : at - startDate,
    ]);
  }

  if (raw.length < 2) return null;

  const coordinates = decimateTrack(raw, 3);
  return {
    coordinates,
    pointCount: coordinates.length,
    bounds: trackBounds(coordinates),
    polyline: encodePolyline(coordinates.map(([lng, lat]) => [lat, lng] as [number, number])),
    distanceM: trackDistanceM(coordinates),
  };
}

// ——— Identity ————————————————————————————————————————————————————

/**
 * A stable id for a workout. HAE supplies one when it can; when it cannot, the
 * natural key (name + start + end) is hashed. Either way re-posting the same
 * workout updates in place rather than duplicating it.
 */
export function workoutExternalId(w: HaeWorkout): string {
  if (typeof w.id === 'string' && w.id.trim()) return w.id.trim();
  const natural = `${w.name ?? ''}|${w.start ?? ''}|${w.end ?? ''}`;
  return createHash('sha256').update(natural).digest('hex').slice(0, 32);
}

// ——— Fields we model explicitly, so metadata keeps only the remainder ———

const MODELLED_KEYS = new Set([
  'id',
  'name',
  'start',
  'end',
  'duration',
  'distance',
  'elevationUp',
  'elevationDown',
  'activeEnergyBurned',
  'totalEnergy',
  'heartRateData',
  'stepCadence',
  'speed',
  'route',
]);

// ——— The mapper ——————————————————————————————————————————————————

export class WorkoutMappingError extends Error {}

export function mapWorkout(w: HaeWorkout): MappedWorkout {
  const startDate = parseHaeDate(w.start);
  const endDate = parseHaeDate(w.end);

  if (startDate == null) throw new WorkoutMappingError('workout has no parseable start date');
  if (endDate == null) throw new WorkoutMappingError('workout has no parseable end date');
  if (endDate < startDate) throw new WorkoutMappingError('workout ends before it starts');

  const externalId = workoutExternalId(w);
  const rawType = typeof w.name === 'string' && w.name.trim() ? w.name.trim() : null;
  const activityType = normaliseActivityType(rawType);

  const track = mapTrack(w.route, startDate);

  const heartRate = mapSeries(w.heartRateData, 'heart_rate', 'bpm', startDate);
  const cadence = mapSeries(w.stepCadence, 'cadence', 'spm', startDate);
  const speed = mapSeries(w.speed, 'speed', 'm/s', startDate);
  const series = [heartRate, cadence, speed].filter((s): s is MappedSeries => s !== null);

  const hr = seriesStats(heartRate);
  const cadenceStats = seriesStats(cadence);

  // Duration: prefer what Apple reported, fall back to the wall clock.
  const reportedDuration = quantity(w.duration);
  const durationS = Math.max(0, endDate - startDate);
  const activeDurationS = reportedDuration ? Math.round(reportedDuration.qty) : null;

  // Distance: Apple's own figure wins — it is fused from GPS and the
  // accelerometer, so it beats summing our decimated GPS points. The track
  // distance is the fallback when the workout carries no distance field.
  const distanceM = toMetres(w.distance) ?? track?.distanceM ?? null;

  // Elevation: prefer the track, which is per-point, over Apple's single
  // elevationUp figure — but keep Apple's when there is no track.
  const trackElevation = track ? elevationDelta(track.coordinates) : null;
  const elevationGainM = trackElevation?.gainM ?? toMetres(w.elevationUp, 'm');
  const elevationLossM = trackElevation?.lossM ?? toMetres(w.elevationDown, 'm');

  const movingS = activeDurationS && activeDurationS > 0 ? activeDurationS : durationS;
  const avgPaceSPerKm = distanceM && distanceM > 0 ? (movingS / distanceM) * 1000 : null;

  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(w)) {
    if (!MODELLED_KEYS.has(key) && value != null) metadata[key] = value;
  }

  return {
    activity: {
      id: `apple:${externalId}`,
      source: 'apple',
      externalId,
      name: rawType ?? 'Workout',
      activityType,
      rawType,
      startDate,
      endDate,
      startDateLocal: w.start ?? new Date(startDate * 1000).toISOString(),
      timezone: extractOffset(w.start),
      distanceM,
      durationS,
      activeDurationS,
      elevationGainM,
      elevationLossM,
      avgHeartrate: hr.avg,
      maxHeartrate: hr.max,
      activeEnergyKj: toKilojoules(w.activeEnergyBurned),
      totalEnergyKj: toKilojoules(w.totalEnergy),
      avgPaceSPerKm,
      avgCadence: cadenceStats.avg,
      hasTrack: track !== null,
      metadata: Object.keys(metadata).length ? metadata : null,
    },
    track,
    series,
  };
}
