// src/lib/trips/routing.server.ts
//
// Travel times and leg lines for the trip planner (D1).
//
// WHAT MAY BE STORED DECIDES THE ORDER. Mapbox Product Terms §2.10.1 (21 July
// 2026): results from a Navigation API — Directions and Matrix — may not be
// cached or stored (see the spec's "D1 storage check"). A plan version is
// stored, and so is the matrix it was solved against (the phone re-times from
// it offline). So the STORED matrix is built from:
//
//   walk / cycle / drive   openrouteservice matrix → distance × factor estimate
//   transit                Transitous (MOTIS) itineraries → estimate
//
// both cached per pair in `app_settings` for 30 days (ORS and Transitous are
// open-data services with no such restriction). Mapbox is used LIVE ONLY:
// `liveMatrix` / `liveDriveLegs` answer a person looking at a day ("drive now:
// 14 min with traffic") and their answers are returned and dropped — never
// written anywhere.
//
// No key on this host (the local preview has none) is the ordinary state: every
// mode then falls back to the estimate and is marked `estimated`, which the
// page shows.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { estimateMatrix, estimateLeg } from '$lib/trips/solver';
import { decodePolyline, fromLngLat, simplifyLine } from './geo';
import type { LatLng, LocalDate, PlannedDay, PlannedLeg, SolvedPlan, TravelMatrix, TravelMode } from './model';
import {
  assembleMode,
  localToIso,
  localDateIn,
  matrixBlocks,
  matrixModes,
  pairKey,
  timetableDate,
  type PairAnswer,
  type RoutePoint,
} from './routing';

const CACHE_TTL_MS = 30 * 86_400_000;
const CACHE_MAX = 6000;
const ORS_BASE = 'https://api.openrouteservice.org';
const ORS_PROFILE: Partial<Record<TravelMode, string>> = { walk: 'foot-walking', cycle: 'cycling-regular', drive: 'driving-car' };
/** ORS free plan: 3,500 matrix elements per request; stay well under it. */
const ORS_MAX_POINTS = 50;
const TRANSITOUS = 'https://api.transitous.org/api/v1/plan';
/** Transitous asks to be used lightly: at most this many itinerary requests per build, serialised. */
const TRANSIT_REQUESTS_PER_BUILD = 24;
const TRANSIT_GAP_MS = 250;
/** Below this straight-line distance a "transit" leg is a walk; not worth a timetable query. */
const TRANSIT_MIN_M = 700;
/** Lines fetched per solve; the rest stay straight until the next solve fills them. */
const LINES_PER_SOLVE = 40;
const USER_AGENT = 'StrangeRamblingsTrips/1.0 (+https://strangeramblings.com)';
const TIMEOUT_MS = 12_000;

type Cached = Record<string, { at: number; s: number | null; m: number | null }>;

async function readCache(key: string): Promise<Cached> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return ((row?.value as Cached | undefined) ?? {}) as Cached;
  } catch {
    return {};
  }
}

async function writeCache(key: string, cache: Cached): Promise<void> {
  const fresh = Object.entries(cache)
    .filter(([, v]) => Date.now() - v.at < CACHE_TTL_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, CACHE_MAX);
  const value = Object.fromEntries(fresh);
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
    .catch((err) => console.warn('[trips/routing] cache write failed:', (err as Error)?.message));
}

const cacheKeyFor = (mode: TravelMode) => `trips.matrix.${mode}`;

function freshAnswers(cache: Cached): Map<string, PairAnswer> {
  const out = new Map<string, PairAnswer>();
  for (const [k, v] of Object.entries(cache)) if (Date.now() - v.at < CACHE_TTL_MS) out.set(k, { s: v.s, m: v.m });
  return out;
}

// ── openrouteservice ───────────────────────────────────────────────────────

async function orsHeaders(url: string): Promise<Record<string, string> | null> {
  try {
    const { resolveSecretForUrl } = await import('$lib/secrets/registry');
    return (await resolveSecretForUrl('openrouteservice', url, 'POST')).headers ?? null;
  } catch (err) {
    if (!/no secret registered/i.test(String((err as Error)?.message ?? err))) {
      console.warn('[trips/routing] openrouteservice credential:', (err as Error)?.message);
    }
  }
  return process.env.ORS_API_KEY ? { Authorization: process.env.ORS_API_KEY } : null;
}

async function orsPost(path: string, body: unknown): Promise<unknown> {
  const url = `${ORS_BASE}${path}`;
  const headers = await orsHeaders(url);
  if (!headers) throw new Error('no openrouteservice credential');
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, application/geo+json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`openrouteservice ${res.status}`);
  return res.json();
}

/** Every pair among `points` for one mode, from ORS, or null when ORS cannot answer. */
async function orsMatrix(points: RoutePoint[], mode: TravelMode): Promise<Map<string, PairAnswer> | null> {
  const profile = ORS_PROFILE[mode];
  if (!profile || points.length < 2) return null;
  const out = new Map<string, PairAnswer>();
  try {
    for (const block of matrixBlocks(points.length, ORS_MAX_POINTS)) {
      const coords = block.coords.map((i) => points[i]);
      const data = (await orsPost(`/v2/matrix/${profile}`, {
        locations: coords.map((p) => [p.location.lng, p.location.lat]),
        sources: block.sources,
        destinations: block.destinations,
        metrics: ['duration', 'distance'],
      })) as { durations?: Array<Array<number | null>>; distances?: Array<Array<number | null>> };
      if (!Array.isArray(data.durations)) return null;
      block.sources.forEach((si, r) => {
        block.destinations.forEach((di, c) => {
          const a = coords[si];
          const b = coords[di];
          if (a === b) return;
          out.set(pairKey(a.location, b.location), { s: data.durations?.[r]?.[c] ?? null, m: data.distances?.[r]?.[c] ?? null });
        });
      });
    }
  } catch (err) {
    if (!/no openrouteservice credential/.test(String((err as Error)?.message))) {
      console.warn(`[trips/routing] ORS ${mode} matrix failed:`, (err as Error)?.message);
    }
    return null;
  }
  return out;
}

async function orsLine(mode: TravelMode, a: LatLng, b: LatLng): Promise<{ line: LatLng[]; s: number; m: number } | null> {
  const profile = ORS_PROFILE[mode];
  if (!profile) return null;
  try {
    const data = (await orsPost(`/v2/directions/${profile}/geojson`, {
      coordinates: [
        [a.lng, a.lat],
        [b.lng, b.lat],
      ],
    })) as { features?: Array<{ geometry?: { coordinates?: number[][] }; properties?: { summary?: { duration?: number; distance?: number } } }> };
    const f = data.features?.[0];
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return { line: simplifyLine(fromLngLat(coords)), s: f?.properties?.summary?.duration ?? 0, m: f?.properties?.summary?.distance ?? 0 };
  } catch {
    return null;
  }
}

// ── Transitous (MOTIS 2) ───────────────────────────────────────────────────

interface TransitAnswer extends PairAnswer {
  line: LatLng[] | null;
}

let transitChain = Promise.resolve();

/** One itinerary a → b leaving at `departIso`; null for no answer (no coverage, timeout). */
async function transitousPlan(a: LatLng, b: LatLng, departIso: string): Promise<TransitAnswer | null> {
  const run = async (): Promise<TransitAnswer | null> => {
    const url = new URL(TRANSITOUS);
    url.searchParams.set('fromPlace', `${a.lat},${a.lng}`);
    url.searchParams.set('toPlace', `${b.lat},${b.lng}`);
    url.searchParams.set('time', departIso);
    url.searchParams.set('numItineraries', '1');
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        itineraries?: Array<{ duration?: number; startTime?: string; legs?: Array<{ distance?: number; legGeometry?: { points?: string; precision?: number } }> }>;
        direct?: Array<{ duration?: number }>;
      };
      const it = data.itineraries?.[0];
      if (!it || !Number.isFinite(it.duration)) return null;
      // The wait before the first departure counts: a 20-minute ride that
      // leaves in 25 minutes is a 45-minute leg from "now".
      const waitSec = it.startTime ? Math.max(0, (Date.parse(it.startTime) - Date.parse(departIso)) / 1000) : 0;
      const line = (it.legs ?? []).flatMap((l) => (l.legGeometry?.points ? decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 7) : []));
      const metres = (it.legs ?? []).reduce((sum, l) => sum + (Number.isFinite(l.distance) ? Number(l.distance) : 0), 0);
      return { s: Math.round((it.duration ?? 0) + Math.min(waitSec, 30 * 60)), m: metres || null, line: line.length > 1 ? simplifyLine(line) : null };
    } catch {
      return null;
    }
  };
  const slot = transitChain.then(run);
  transitChain = slot.then(
    () => new Promise((r) => setTimeout(r, TRANSIT_GAP_MS)),
    () => new Promise((r) => setTimeout(r, TRANSIT_GAP_MS)),
  );
  return slot;
}

// ── The stored matrix ──────────────────────────────────────────────────────

export interface MatrixBuild {
  matrix: TravelMatrix;
  /** One line per mode: where its figures came from. */
  notes: string[];
}

/**
 * The trip-wide matrix the solver plans with and the plan stores: every point
 * to every point for walk plus the trip's modes. Never contains a Mapbox figure.
 */
export async function buildStoredMatrix(
  points: RoutePoint[],
  trip: { modes: TravelMode[]; startDate: LocalDate; timeZone: string },
): Promise<MatrixBuild> {
  const modes = matrixModes(trip.modes);
  const estimate = estimateMatrix(points, modes);
  const matrix: TravelMatrix = { points: points.map((p) => p.id), seconds: {}, metres: {}, estimated: {} };
  const notes: string[] = [];

  for (const mode of modes) {
    const cacheKey = cacheKeyFor(mode);
    const cache = await readCache(cacheKey);
    const answers = freshAnswers(cache);
    const missing = () =>
      points.some((a) => points.some((b) => a !== b && !answers.has(pairKey(a.location, b.location))));

    let source = 'cache';
    if (mode !== 'transit' && missing()) {
      const ors = await orsMatrix(points, mode);
      if (ors) {
        for (const [k, v] of ors) {
          answers.set(k, v);
          cache[k] = { at: Date.now(), ...v };
        }
        await writeCache(cacheKey, cache);
        source = 'openrouteservice';
      }
    }
    if (mode === 'transit' && missing()) {
      const day = timetableDate(trip.startDate, localDateIn(trip.timeZone, new Date()));
      const departIso = localToIso(day, 10 * 60, trip.timeZone);
      let asked = 0;
      let answered = 0;
      for (const a of points) {
        for (const b of points) {
          if (a === b) continue;
          const key = pairKey(a.location, b.location);
          if (answers.has(key)) continue;
          const crow = estimateLeg(a.location, b.location, 'walk').metres / 1.3;
          if (crow < TRANSIT_MIN_M) {
            // Short hops are walks; the solver walks them anyway.
            const walk = estimateLeg(a.location, b.location, 'walk');
            answers.set(key, { s: walk.seconds, m: walk.metres });
            continue;
          }
          if (asked >= TRANSIT_REQUESTS_PER_BUILD) continue;
          asked++;
          const hit = await transitousPlan(a.location, b.location, departIso);
          if (hit) {
            answered++;
            answers.set(key, { s: hit.s, m: hit.m });
            cache[key] = { at: Date.now(), s: hit.s, m: hit.m };
          }
        }
      }
      if (answered) await writeCache(cacheKey, cache);
      source = answered ? 'Transitous' : asked ? 'Transitous (no answer)' : 'cache';
    }

    const est = estimate.seconds[mode] ? mode : 'walk';
    const idx = new Map(points.map((p, i) => [p, i]));
    const assembled = assembleMode(points, answers, (a, b) => ({
      s: estimate.seconds[est]?.[idx.get(a)!]?.[idx.get(b)!] ?? null,
      m: estimate.metres[est]?.[idx.get(a)!]?.[idx.get(b)!] ?? null,
    }));
    matrix.seconds[mode] = assembled.seconds;
    matrix.metres[mode] = assembled.metres;
    const pairs = points.length * (points.length - 1);
    matrix.estimated[mode] = assembled.estimatedCells > 0;
    notes.push(
      assembled.estimatedCells === 0
        ? `${mode}: routed (${source})`
        : assembled.estimatedCells === pairs
          ? `${mode}: estimated from distance`
          : `${mode}: ${pairs - assembled.estimatedCells} of ${pairs} routed (${source}), the rest estimated`,
    );
  }
  return { matrix, notes };
}

/**
 * Lines for the plan's legs: reused from the previous version where the same
 * two places are joined by the same mode, otherwise routed (ORS for
 * walk/cycle/drive, Transitous for transit) up to LINES_PER_SOLVE per call;
 * the rest stay null and the map draws them straight.
 */
export async function attachLegLines(plan: SolvedPlan, previous: SolvedPlan | null, trip: { startDate: LocalDate; timeZone: string }): Promise<SolvedPlan> {
  const where = (day: PlannedDay, id: string) => day.stops.find((s) => s.id === id)?.location ?? null;
  const known = new Map<string, LatLng[]>();
  for (const day of previous?.days ?? []) {
    for (const leg of day.legs) {
      const a = where(day, leg.fromStopId);
      const b = where(day, leg.toStopId);
      if (a && b && leg.line) known.set(`${leg.mode}|${pairKey(a, b)}`, leg.line);
    }
  }
  let fetched = 0;
  const days: PlannedDay[] = [];
  for (const day of plan.days) {
    const legs: PlannedLeg[] = [];
    for (const leg of day.legs) {
      if (leg.line) {
        legs.push(leg);
        continue;
      }
      const a = where(day, leg.fromStopId);
      const b = where(day, leg.toStopId);
      if (!a || !b || (a.lat === b.lat && a.lng === b.lng)) {
        legs.push(leg);
        continue;
      }
      const key = `${leg.mode}|${pairKey(a, b)}`;
      let line = known.get(key) ?? null;
      if (!line && fetched < LINES_PER_SOLVE) {
        fetched++;
        if (leg.mode === 'transit') {
          const departIso = localToIso(timetableDate(trip.startDate, localDateIn(trip.timeZone, new Date())), 10 * 60, trip.timeZone);
          line = (await transitousPlan(a, b, departIso))?.line ?? null;
        } else {
          line = (await orsLine(leg.mode, a, b))?.line ?? null;
        }
        if (line) known.set(key, line);
      }
      legs.push({ ...leg, line });
    }
    days.push({ ...day, legs });
  }
  return { ...plan, days };
}

// ── Live only (Mapbox) — NEVER stored ──────────────────────────────────────

/**
 * Live Mapbox times among `points` for one mode, chunked to Mapbox's
 * coordinate cap (25, or 10 on the traffic profile). Returned to the caller
 * and dropped: Product Terms §2.10.1 forbids caching or storing it. Null when
 * Mapbox is not configured or fails.
 */
export async function liveMatrix(points: RoutePoint[], mode: 'walk' | 'cycle' | 'drive'): Promise<Map<string, PairAnswer> | null> {
  if (points.length < 2) return new Map();
  const { mapboxApiConfigured, matrix, maxWaypointsFor } = await import('$lib/maps/mapbox-api');
  if (!(await mapboxApiConfigured())) return null;
  const out = new Map<string, PairAnswer>();
  try {
    for (const block of matrixBlocks(points.length, maxWaypointsFor(mode))) {
      const coords = block.coords.map((i) => points[i]);
      const res = await matrix({
        mode,
        coordinates: coords.map((p) => [p.location.lng, p.location.lat]),
        sources: block.sources,
        destinations: block.destinations,
      });
      block.sources.forEach((si, r) => {
        block.destinations.forEach((di, c) => {
          if (coords[si] === coords[di]) return;
          out.set(pairKey(coords[si].location, coords[di].location), { s: res.durations[r]?.[c] ?? null, m: null });
        });
      });
    }
  } catch (err) {
    console.warn('[trips/routing] live Mapbox matrix failed:', (err as Error)?.message);
    return null;
  }
  return out;
}

export interface LiveLeg {
  fromStopId: string;
  toStopId: string;
  /** Live drive time with traffic, minutes; null when Mapbox could not say. */
  liveMin: number | null;
}

/** Live drive times for one day's drive legs (display only; see liveMatrix). */
export async function liveDriveLegs(day: PlannedDay): Promise<{ available: boolean; legs: LiveLeg[] }> {
  const drive = day.legs.filter((l) => l.mode === 'drive');
  if (!drive.length) return { available: true, legs: [] };
  const byId = new Map(day.stops.map((s) => [s.id, s]));
  const points: RoutePoint[] = [];
  for (const s of day.stops) if (s.location && !points.some((p) => p.id === s.id)) points.push({ id: s.id, location: s.location });
  const live = await liveMatrix(points, 'drive');
  if (!live) return { available: false, legs: drive.map((l) => ({ fromStopId: l.fromStopId, toStopId: l.toStopId, liveMin: null })) };
  return {
    available: true,
    legs: drive.map((l) => {
      const a = byId.get(l.fromStopId)?.location;
      const b = byId.get(l.toStopId)?.location;
      const s = a && b ? (live.get(pairKey(a, b))?.s ?? null) : null;
      return { fromStopId: l.fromStopId, toStopId: l.toStopId, liveMin: s === null ? null : Math.round(s / 60) };
    }),
  };
}
