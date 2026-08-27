// src/lib/daydream/observe.ts
//
// Writing the trail. Both writers land here — the push endpoint that Home
// Assistant posts to, and the poll floor that runs on the heartbeat — so the
// derivation of speed, mode and place happens exactly once and cannot drift
// between them.
//
// The one rule worth restating: **a failed look is a row.** `recordGap` exists
// so that a window with no fixes can be told apart from a window nobody
// watched. Without it every detector reasoning over time is guessing, and the
// first thing it guesses wrong is "you have not left the house in three days"
// when the truth is that homeserv was down.

import { and, desc, eq, gte, isNotNull, lt } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamTrail, daydreamPlaces } from '$lib/db/schema';
import {
  inferMode,
  looksLikeRail,
  metresBetween,
  speedKmhBetween,
  haversineKm,
} from './cluster';
import {
  DEFAULT_SUBJECT,
  MAX_USABLE_ACCURACY_M,
  RAIL_MIN_FIXES,
  TRAIL_RETENTION_DAYS,
  errMsg,
  type IncomingFix,
  type MovementMode,
  type TrailSource,
} from './types';

export interface RecordedFix {
  id: number;
  ts: Date;
  speedKmh: number | null;
  mode: MovementMode;
  placeId: string | null;
  isHome: boolean | null;
  distanceHomeKm: number | null;
}

/** Coordinates that are merely wrong rather than merely imprecise. */
function isPlausibleCoord(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    // Null Island is what a broken GPS reports, not where anyone is.
    !(lat === 0 && lon === 0)
  );
}

/**
 * Home Assistant's own state string is authoritative for "am I home" — its
 * zone logic already accounts for the zone radius and for zones we know
 * nothing about. The distance fallback only applies when the state is not a
 * zone verdict at all. Same precedence the location-context node uses.
 */
function resolveIsHome(haState: string | null | undefined, distanceHomeKm: number | null): boolean | null {
  if (haState === 'home') return true;
  if (haState === 'not_home') return false;
  if (distanceHomeKm == null) return null;
  return distanceHomeKm < 0.15;
}

/** The home place, when one has been established. Null is normal on day one —
 *  the place graph has to see you at home a few times first. */
async function getHomePlace(): Promise<{ lat: number; lon: number } | null> {
  const [home] = await db
    .select({ lat: daydreamPlaces.lat, lon: daydreamPlaces.lon })
    .from(daydreamPlaces)
    .where(and(eq(daydreamPlaces.kind, 'home'), eq(daydreamPlaces.status, 'active')))
    .limit(1);
  return home ?? null;
}

/**
 * The most recent positioned fixes, for deriving speed and spotting rail.
 *
 * Keyed on "has a position", not on source: a poll fix anchors a speed
 * calculation exactly as well as a push fix does, and filtering to one writer
 * would make every speed null for as long as the other one happened to be
 * carrying the trail. Gap rows carry no position and are excluded by the same
 * condition that includes everything else.
 */
async function getPriorFixes(subject: string, limit: number) {
  return db
    .select({
      ts: daydreamTrail.ts,
      lat: daydreamTrail.lat,
      lon: daydreamTrail.lon,
      speedKmh: daydreamTrail.speedKmh,
    })
    .from(daydreamTrail)
    .where(and(eq(daydreamTrail.subject, subject), isNotNull(daydreamTrail.lat)))
    .orderBy(desc(daydreamTrail.ts))
    .limit(limit);
}

/** Which known place, if any, this fix falls inside. */
async function resolvePlaceId(lat: number, lon: number): Promise<string | null> {
  const places = await db
    .select({ id: daydreamPlaces.id, lat: daydreamPlaces.lat, lon: daydreamPlaces.lon, radiusM: daydreamPlaces.radiusM })
    .from(daydreamPlaces)
    .where(eq(daydreamPlaces.status, 'active'));

  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const p of places) {
    const d = metresBetween(lat, lon, p.lat, p.lon);
    if (d <= p.radiusM && d < bestDist) {
      bestDist = d;
      bestId = p.id;
    }
  }
  return bestId;
}

/**
 * Write one observation.
 *
 * Everything derived here is best-effort and degrades to null rather than to a
 * confident wrong answer: no previous fix means no speed, no speed means mode
 * `unknown` (never `still`), no home place means no distance-from-home. A fix
 * whose accuracy circle is wider than MAX_USABLE_ACCURACY_M is still stored —
 * the position may be roughly right — but it is not allowed to resolve a
 * place, because a 500 m circle "arrives" at every shop you drove past.
 */
export async function recordFix(
  fix: IncomingFix,
  source: Exclude<TrailSource, 'gap'>,
  subject: string = DEFAULT_SUBJECT,
): Promise<RecordedFix> {
  if (!isPlausibleCoord(fix.lat, fix.lon)) {
    throw new Error(`implausible coordinates: ${fix.lat},${fix.lon}`);
  }

  const ts = fix.at ? new Date(fix.at) : new Date();
  if (Number.isNaN(ts.getTime())) {
    throw new Error(`unparseable timestamp: ${fix.at}`);
  }

  const priors = await getPriorFixes(subject, RAIL_MIN_FIXES);
  const prev = priors[0] ?? null;

  const speedKmh = speedKmhBetween(
    prev ? { ts: prev.ts, lat: prev.lat, lon: prev.lon } : null,
    fix.lat,
    fix.lon,
    ts,
  );

  let mode = inferMode(speedKmh);
  if (mode === 'vehicle') {
    // `priors` is newest-first; looksLikeRail wants newest-last, and the
    // current fix is the newest of all.
    const window = [...priors].reverse().map((p) => ({
      lat: p.lat ?? 0,
      lon: p.lon ?? 0,
      speedKmh: p.speedKmh,
    }));
    window.push({ lat: fix.lat, lon: fix.lon, speedKmh });
    if (looksLikeRail(window)) mode = 'rail';
  }

  const home = await getHomePlace();
  const distanceHomeKm = home
    ? Math.round(haversineKm(home.lat, home.lon, fix.lat, fix.lon) * 100) / 100
    : null;

  const accuracyM = fix.accuracyM ?? null;
  const usable = accuracyM == null || accuracyM <= MAX_USABLE_ACCURACY_M;
  const placeId = usable ? await resolvePlaceId(fix.lat, fix.lon) : null;

  const [row] = await db
    .insert(daydreamTrail)
    .values({
      ts,
      subject,
      source,
      lat: fix.lat,
      lon: fix.lon,
      accuracyM,
      haState: fix.haState ?? null,
      isHome: resolveIsHome(fix.haState, distanceHomeKm),
      distanceHomeKm,
      speedKmh,
      mode,
      placeId,
      batteryPct: fix.batteryPct ?? null,
      readingAgeS: fix.readingAgeS ?? null,
    })
    .returning({ id: daydreamTrail.id, ts: daydreamTrail.ts, isHome: daydreamTrail.isHome });

  return {
    id: row.id,
    ts: row.ts,
    speedKmh,
    mode,
    placeId,
    isHome: row.isHome,
    distanceHomeKm,
  };
}

/**
 * Record that we looked and could not see.
 *
 * This is the row that makes coverage computable. It is deliberately NOT an
 * error path — Home Assistant being unreachable from the VPS is an ordinary,
 * recurring state, and the correct response is to write down that we do not
 * know rather than to log a warning nobody reads and leave a hole that later
 * reads as "he was in all day".
 */
export async function recordGap(
  reason: string,
  subject: string = DEFAULT_SUBJECT,
): Promise<void> {
  await db.insert(daydreamTrail).values({
    subject,
    source: 'gap',
    mode: 'unknown',
    note: reason.slice(0, 500),
  });
}

/** True when a fix has landed recently enough that the poll floor can stand
 *  down. The push stream only fires on movement, so this is also what stops a
 *  still afternoon from looking like a dead sensor. */
export async function hasFreshFix(
  withinMs: number,
  subject: string = DEFAULT_SUBJECT,
): Promise<boolean> {
  const since = new Date(Date.now() - withinMs);
  const rows = await db
    .select({ id: daydreamTrail.id })
    .from(daydreamTrail)
    .where(
      and(
        eq(daydreamTrail.subject, subject),
        eq(daydreamTrail.source, 'push'),
        gte(daydreamTrail.ts, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Drop raw fixes past the retention horizon. Places, which are the point of
 *  having kept them, are aggregates and survive. */
export async function pruneTrail(retentionDays = TRAIL_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const deleted = await db
    .delete(daydreamTrail)
    .where(lt(daydreamTrail.ts, cutoff))
    .returning({ id: daydreamTrail.id });
  return deleted.length;
}

/**
 * Read the current position from Home Assistant. Used by the poll floor only —
 * the push path already carries a position.
 *
 * Returns null rather than throwing when HA is unreachable or the entity has
 * no GPS, so the caller writes a gap row with the reason instead of an
 * exception disappearing into a pulse summary.
 */
interface HaEntityState {
  entity_id?: string;
  state?: string;
  attributes?: Record<string, unknown>;
  last_reported?: string;
  last_updated?: string;
  last_changed?: string;
}

/**
 * Turn one HA entity state into a fix, or say why it cannot be one. PURE, so
 * the parsing that decides whether a family member "reported no GPS" is
 * unit-testable without a Home Assistant.
 */
export function fixFromEntityState(
  state: HaEntityState,
  entityName: string,
  now: Date = new Date(),
): { fix: IncomingFix } | { error: string } {
  const attrs = state.attributes ?? {};
  const lat = typeof attrs.latitude === 'number' ? attrs.latitude : null;
  const lon = typeof attrs.longitude === 'number' ? attrs.longitude : null;

  if (lat == null || lon == null) {
    return { error: `${entityName} reported no GPS position (state: ${state.state ?? 'unknown'})` };
  }

  const seenIso =
    (typeof attrs.last_seen === 'string' ? attrs.last_seen : null) ??
    state.last_reported ??
    state.last_updated ??
    state.last_changed ??
    null;
  const seenMs = seenIso ? Date.parse(seenIso) : Number.NaN;
  const readingAgeS = Number.isFinite(seenMs)
    ? Math.max(0, Math.round((now.getTime() - seenMs) / 1000))
    : null;

  return {
    fix: {
      lat,
      lon,
      accuracyM: typeof attrs.gps_accuracy === 'number' ? attrs.gps_accuracy : null,
      haState: typeof state.state === 'string' ? state.state : null,
      batteryPct: typeof attrs.battery_level === 'number' ? Math.round(attrs.battery_level) : null,
      readingAgeS,
    },
  };
}

export async function pollHomeAssistant(
  personEntity = 'person.john',
): Promise<{ fix: IncomingFix } | { error: string }> {
  try {
    const { getHomeAssistantService } = await import('$lib/workflows/homeassistant/service');
    const res = await getHomeAssistantService().queryState(personEntity);
    if (!res.success || !res.data) {
      return { error: `HA unreachable or entity missing: ${res.error ?? 'no data'}` };
    }
    return fixFromEntityState(res.data as HaEntityState, personEntity);
  } catch (err) {
    return { error: errMsg(err) };
  }
}

/**
 * Poll every tracked person in ONE Home Assistant round trip.
 *
 * `/api/states` returns the whole house (~415 entities) but it is one HTTP
 * call every two minutes against five `queryState` calls — and more
 * importantly it is atomic: every member's position is read at the same
 * instant, so "who was home when" cannot be skewed by the poll order. HA
 * being unreachable yields the same error for every subject, and the caller
 * writes one gap row each — five people un-observed is five facts, not one.
 */
export async function pollAllSubjects(
  subjects: ReadonlyArray<{ subject: string; entity: string }>,
): Promise<Map<string, { fix: IncomingFix } | { error: string }>> {
  const out = new Map<string, { fix: IncomingFix } | { error: string }>();
  try {
    const { getHomeAssistantService } = await import('$lib/workflows/homeassistant/service');
    const res = await getHomeAssistantService().queryAllStates();
    if (!res.success || !Array.isArray(res.data)) {
      const error = `HA unreachable: ${res.error ?? 'no data'}`;
      for (const s of subjects) out.set(s.subject, { error });
      return out;
    }
    const byId = new Map<string, HaEntityState>();
    for (const row of res.data as HaEntityState[]) {
      if (row?.entity_id) byId.set(row.entity_id, row);
    }
    const now = new Date();
    for (const s of subjects) {
      const state = byId.get(s.entity);
      out.set(
        s.subject,
        state ? fixFromEntityState(state, s.entity, now) : { error: `${s.entity} not found in HA` },
      );
    }
  } catch (err) {
    const error = errMsg(err);
    for (const s of subjects) out.set(s.subject, { error });
  }
  return out;
}
