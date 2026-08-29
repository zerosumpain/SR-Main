// src/lib/geo/service.ts
//
// SERVER ONLY. The ingest half of Landgrab: read both movement corpora, run the
// pure geometry in the rest of $lib/geo over them, and write the ledger.
//
// Every other file in this directory is pure TypeScript with no database and no
// dependencies. This one is the seam, and it is the only file here that imports
// $lib/db. Nothing under src/lib/components or any +page.svelte may import it —
// a claim ring's vertices are real GPS fixes and would correctly trip
// disclosureLeaks(); the whole privacy posture is that this data never leaves an
// owner session.
//
// Four things about the reads are load-bearing, and three of them are the kind
// of mistake that is invisible until the numbers are already wrong:
//
//  1. NEVER filter daydream_trail by a `source` allow-list. The column has FOUR
//     values in practice — push | poll | gap | backfill — and `backfill` is the
//     entire historical corpus for four of the five subjects. An allow-list
//     built from the two obvious ones silently deletes most of the game. Filter
//     by isNotNull(lat) and the accuracy gate, which is what actually decides
//     whether a row is evidence.
//  2. Workouts are John's alone. `activities` has no person column and every
//     row arrives through one shared APPLE_HEALTH_API_KEY webhook. Attributing
//     them to anyone else would be a guess, and the day a second family watch
//     posts to that key this becomes wrong silently — hence WORKOUT_SUBJECT
//     being one named constant rather than a string literal in a query.
//  3. Both owner controls on `activities` have to be honoured at the QUERY:
//     `excluded_from_segments` (a drive logged as a ride) and `type_override`
//     (the owner's type correction, which ingest would clobber if it were
//     written back to `activity_type`). Same rule rebuildSegments follows.
//  4. CYCLING SCORES (Amendment 1, John 2026-08-29) and is filtered at the
//     VIEWING layer, which is only possible because every event and every claim
//     this file writes carries `activity_type`. Nothing is skipped for being a
//     ride. A trail row gets NULL, honestly — Life360 has no activity type and
//     `mode` cannot stand in for one: it derives from GPS speed and the repo's
//     own MOVEMENT_MODES comment says a runner and a cyclist both land in
//     `active` at 6.5-18 km/h. So the filter dimensions are `source_kind` and
//     `activity_type`, and "untyped" is a real answer rather than a guess.
//
//  5. The car gate is a different thing. `excludedModes` and the speed ceiling
//     live in cleanJourney, and cleanJourney is now on the TRAMPLE path as well
//     as the loop path — see tilesOf. It was not, and a drive would have painted
//     weight-1 ground down every A-road it used.
//
//     The ceiling is now activity-aware (Amendment 2): a fix carrying a declared
//     `ride`/`mtb` type is judged at `rideMaxSpeedKmh`, everything else at the
//     unchanged 25 km/h `maxSpeedKmh`. That is why `activityType` is stamped
//     onto every workout FIX and not only onto the outing — cleanJourney reads
//     it per fix. A trail fix carries null and keeps the strict gate.
//
// Re-running is a no-op by construction, and that is the property the whole
// hourly heartbeat rests on: the ledger's uniqueIndex plus ON CONFLICT DO
// NOTHING means the earliest write wins, which is the same rule dedupeEvents()
// applies in memory. Ownership is a pure function of the ledger, so recomputing
// it twice gives the same answer.

import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '$lib/db';
import {
  activities,
  activityTracks,
  daydreamTrail,
  geoCaptureEvents,
  geoClaims,
  geoDailySnapshot,
  geoTileState,
} from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { segmentJourneys, type JourneyFix } from '$lib/daydream/journeys';
import type { MovementMode } from '$lib/daydream/types';
import { encodePolyline } from '$lib/health/polyline';
import { effectiveType } from '$lib/trails/activity-meta';
import {
  detectLoops,
  resolveThresholds,
  trampledTiles,
  type GeoFix,
  type GeoThresholds,
  type QualifiedRing,
} from './loops';
import {
  captureEvents,
  dedupeEvents,
  resolveOwnership,
  utcDay,
  type CaptureEvent,
  type CaptureKind,
} from './ownership';
import { connectedComponents } from './dissolve';
import { fillInteriorOfSegments, type FillResult } from './fill';
import { tileAreaM2, tileCentre, tileKeyOf, type Tile } from './tiles';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Every Apple workout is John's — see note 2 above. One place to change. */
export const WORKOUT_SUBJECT = 'john';

/**
 * Workout types that move a person across real ground.
 *
 * Still an ALLOW-list, and still for the original reason: a new normalised type
 * arriving from the phone should score nothing until somebody has decided it
 * should. What changed under Amendment 1 is its CONTENTS, not its shape —
 * `ride` and `mtb` are in it now, because cycling captures. What stays out is
 * what has no ground under it at all: `swim` (a pool workout's GPS trace is the
 * building), and `other`, which is the phone's shrug.
 *
 * This is not the car gate. `excludedModes` and the speed ceiling in
 * cleanJourney are, and they apply to every type in this list — at 45 km/h for
 * `ride`/`mtb` and 25 km/h for the rest (Amendment 2).
 */
export const CAPTURING_ACTIVITY_TYPES = ['run', 'trail_run', 'walk', 'hike', 'ride', 'mtb'] as const;

/**
 * How far back before the watermark to re-read.
 *
 * A journey straddling the watermark would otherwise be cut in half and the
 * two halves would each fail the 400 m closure floor — a loop walked across the
 * top of the hour would silently never score. Re-reading is free because the
 * ledger deduplicates, so this is generous rather than tight.
 */
export const WATERMARK_OVERLAP_MS = 6 * 3_600_000;

/** `setSetting(k, null)` cannot unset — the column is jsonb NOT NULL and a JS
 *  null binds as empty. A reset writes the epoch instead. */
export const GEO_EPOCH = '1970-01-01T00:00:00.000Z';

export const trailWatermarkKey = (subject: string) => `geo:watermark:${subject}`;
export const workoutWatermarkKey = (subject: string) => `geo:watermark:${subject}:workout`;

/** Cells per `(tile_x, tile_y) IN (…)` batch. */
const TILE_BATCH = 1_000;
/** Ledger rows per insert. */
const INSERT_BATCH = 500;
/** Hard ceiling on a single snapshot REPAIR, in days. Roughly a year, which is
 *  well past TRAIL_RETENTION_DAYS, so in practice it never binds — it is there
 *  so a corrupt `day` string cannot turn the roll into an unbounded loop. */
const MAX_SNAPSHOT_REPAIR_DAYS = 400;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestOptions {
  /** Restrict to these trail subjects. Absent means every subject present. */
  subjects?: string[];
  /** Ignore the stored watermarks and read the whole corpus. */
  full?: boolean;
  /** Read from here regardless of the watermark. Implies a wider read, never a
   *  narrower one — a `since` LATER than the watermark would skip ground. */
  since?: Date;
  /** The horizon. Nothing after it is read, and it is the instant ownership is
   *  resolved as at. Injected so tests are not clock-dependent. */
  now?: Date;
  /** Skip the Apple corpus (the trail-only path the tests use). */
  includeWorkouts?: boolean;
  thresholds?: Partial<GeoThresholds>;
}

export interface SubjectIngestReport {
  subject: string;
  fixesRead: number;
  journeys: number;
  /** Rings detected for this subject in this run. Not "new rows" — the
   *  written/skipped split is only meaningful for the run as a whole, and a
   *  per-subject "written" that was always zero would read as a bug. */
  claims: number;
  eventsProposed: number;
  watermarkFrom: string;
  watermarkTo: string;
}

export interface IngestReport {
  startedAt: string;
  now: string;
  full: boolean;
  subjects: SubjectIngestReport[];
  workouts: {
    considered: number;
    claims: number;
    eventsProposed: number;
    watermarkFrom: string;
    watermarkTo: string;
  };
  /** Cells whose ownership was recomputed. */
  tilesTouched: number;
  tileRowsWritten: number;
  /** Rings this run detected, and how many of them were NEW rows. A second run
   *  over unchanged data must report the same total and zero written. */
  claimsTotal: number;
  claimsWritten: number;
  /** Ledger rows offered, and how many the unique index actually accepted. */
  totalEventsProposed: number;
  totalEventsWritten: number;
  /**
   * The interior-fill half, reported separately because it is the one thing in
   * this pipeline whose output is not visible in any other number.
   *
   * `fillTiles` is ground awarded for enclosure without treading;
   * `fillOutingsCapped` is journeys whose interior blew the per-journey ceiling
   * and were paid NOTHING for it. A `fillOutingsCapped` that is anything but
   * near-zero means either the vehicle gates are leaking or the cap wants a
   * retune, and it is the only place that shows.
   */
  fillEventsProposed: number;
  fillTiles: number;
  fillOutingsCapped: number;
  fillInteriorRejected: number;
  elapsedMs: number;
}

/** One journey's worth of geometry, whatever corpus it came from. */
interface Outing {
  subject: string;
  sourceKind: 'trail' | 'workout';
  /** Stable id of the INPUT, so a re-run derives the same claim key. */
  sourceRef: string;
  capturedAt: Date;
  /**
   * The declared activity, or null for a trail journey.
   *
   * Stamped on every claim and every capture event this outing produces, which
   * is the whole of "filterable": the ledger can be read foot-only, ride-only
   * or all of it, after the fact and without a re-ingest. Null is a real value
   * and means untyped, never "assume walk".
   */
  activityType: string | null;
  fixes: GeoFix[];
}

// ---------------------------------------------------------------------------
// Watermarks
// ---------------------------------------------------------------------------

async function readWatermark(key: string): Promise<Date> {
  const raw = await getSetting<string>(key);
  const parsed = typeof raw === 'string' ? new Date(raw) : new Date(GEO_EPOCH);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(GEO_EPOCH);
}

/** Never moves BACKWARDS: a re-run that read less data must not un-advance the
 *  watermark, or the next run would reprocess ground for nothing. */
async function advanceWatermark(key: string, to: Date, from: Date): Promise<string> {
  const next = to.getTime() > from.getTime() ? to : from;
  await setSetting(key, next.toISOString());
  return next.toISOString();
}

// ---------------------------------------------------------------------------
// Reading the corpora
// ---------------------------------------------------------------------------

interface TrailRow {
  ts: Date;
  subject: string;
  lat: number;
  lon: number;
  accuracyM: number | null;
  speedKmh: number | null;
  mode: string;
}

/**
 * Eligible trail fixes for one subject.
 *
 * The `source` column is deliberately absent from this WHERE clause. See note 1
 * at the top of the file — filtering by it deletes the backfilled corpus, which
 * is most of the family's history.
 */
async function readTrail(
  subject: string,
  from: Date,
  now: Date,
  th: GeoThresholds,
): Promise<TrailRow[]> {
  const rows = await db
    .select({
      ts: daydreamTrail.ts,
      subject: daydreamTrail.subject,
      lat: daydreamTrail.lat,
      lon: daydreamTrail.lon,
      accuracyM: daydreamTrail.accuracyM,
      speedKmh: daydreamTrail.speedKmh,
      mode: daydreamTrail.mode,
    })
    .from(daydreamTrail)
    .where(
      and(
        eq(daydreamTrail.subject, subject),
        isNotNull(daydreamTrail.lat),
        isNotNull(daydreamTrail.lon),
        // Absent accuracy is not a reason to drop a fix — most of the Life360
        // corpus has none. Only a REPORTED accuracy worse than the gate is.
        or(isNull(daydreamTrail.accuracyM), lte(daydreamTrail.accuracyM, th.maxAccuracyM)),
        gt(daydreamTrail.ts, from),
        lte(daydreamTrail.ts, now),
      ),
    )
    .orderBy(asc(daydreamTrail.ts));

  return rows.map((r) => ({
    ts: r.ts,
    subject: r.subject,
    lat: r.lat as number,
    lon: r.lon as number,
    accuracyM: r.accuracyM,
    speedKmh: r.speedKmh,
    mode: r.mode,
  }));
}

/** Every subject that has usable trail rows in the window. */
async function trailSubjects(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ subject: daydreamTrail.subject })
    .from(daydreamTrail)
    .where(isNotNull(daydreamTrail.lat));
  return rows.map((r) => r.subject).sort();
}

/**
 * Turn one subject's fixes into outings.
 *
 * `segmentJourneys` is reused rather than re-derived, because it owns what
 * "moving" means: a journey ends when the stillness becomes a VISIT, and if
 * this file picked its own threshold the two halves of the trail would disagree
 * about the same minute. It returns SUMMARIES, so the fixes are sliced back out
 * of the window it reports.
 */
function outingsFromTrail(rows: TrailRow[]): Outing[] {
  const fixes: JourneyFix[] = rows.map((r) => ({
    ts: r.ts,
    lat: r.lat,
    lon: r.lon,
    subject: r.subject,
    speedKmh: r.speedKmh,
    mode: r.mode as MovementMode,
  }));

  const out: Outing[] = [];
  for (const journey of segmentJourneys(fixes)) {
    const startMs = journey.startedAt.getTime();
    const endMs = journey.endedAt.getTime();
    const window = rows.filter(
      (r) => r.subject === journey.subject && r.ts.getTime() >= startMs && r.ts.getTime() <= endMs,
    );
    if (window.length < 2) continue;
    out.push({
      subject: journey.subject,
      sourceKind: 'trail',
      sourceRef: `${journey.subject}@${journey.startedAt.toISOString()}`,
      capturedAt: journey.endedAt,
      // Life360 has no activity type, and `mode` is not one. Untyped.
      activityType: null,
      fixes: window.map((r) => ({
        lat: r.lat,
        lon: r.lon,
        ts: r.ts,
        accuracyM: r.accuracyM,
        speedKmh: r.speedKmh,
        mode: r.mode,
      })),
    });
  }
  return out;
}

/**
 * Eligible Apple workouts as outings.
 *
 * `coordinates` is `[[lng, lat, elevM, secondsFromStart], …]`, one row per
 * activity, so the timestamps are reconstructed from `start_date` plus the
 * fourth element rather than stored per point.
 */
async function readWorkoutOutings(
  from: Date,
  now: Date,
  th: GeoThresholds,
): Promise<{ outings: Outing[]; considered: number; maxStart: Date }> {
  const rows = await db
    .select({
      id: activities.id,
      activityType: sql<string>`coalesce(nullif(trim(${activities.typeOverride}), ''), ${activities.activityType})`,
      startDate: activities.startDate,
      endDate: activities.endDate,
      coordinates: activityTracks.coordinates,
    })
    .from(activities)
    .innerJoin(activityTracks, eq(activityTracks.activityId, activities.id))
    .where(
      and(
        eq(activities.excludedFromSegments, false),
        gt(activities.startDate, Math.floor(from.getTime() / 1000)),
        lte(activities.startDate, Math.floor(now.getTime() / 1000)),
      ),
    )
    .orderBy(asc(activities.startDate));

  const outings: Outing[] = [];
  let maxStart = from;

  for (const row of rows) {
    const type = effectiveType({ activityType: row.activityType });
    maxStart = new Date(Math.max(maxStart.getTime(), row.startDate * 1000));

    // ONE gate, and it is about whether the workout crossed ground at all.
    //
    // The threshold set's `excludedActivityTypes` is deliberately NOT re-applied
    // here. It is a caller-supplied filter now, not a policy (Amendment 1), and
    // cleanJourney already honours it downstream — re-applying it at the read
    // would drop the outing before it could be recorded, which is the
    // filter-at-ingest behaviour John rejected.
    if (!(CAPTURING_ACTIVITY_TYPES as readonly string[]).includes(type)) continue;

    const coords = (row.coordinates ?? []) as Array<[number, number, number | null, number]>;
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const startMs = row.startDate * 1000;
    const fixes: GeoFix[] = [];
    for (const c of coords) {
      if (!Array.isArray(c) || c.length < 2) continue;
      const [lon, lat, , secs] = c;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      fixes.push({
        lat,
        lon,
        ts: new Date(startMs + (Number.isFinite(secs) ? secs * 1000 : 0)),
        // Carried onto the fix because cleanJourney reads it TWICE: once for a
        // caller-supplied `excludedActivityTypes` filter, and once to pick the
        // speed ceiling this leg is judged at (Amendment 2). The workout has no
        // per-point accuracy or mode, so the implied-speed cut is the only
        // vehicle defence on this path and the declared type is the only thing
        // that can safely raise it.
        activityType: type,
      });
    }
    if (fixes.length < 2) continue;

    outings.push({
      subject: WORKOUT_SUBJECT,
      sourceKind: 'workout',
      // `activities.id` is already `${source}:${externalId}` — e.g.
      // `apple:DCC97BA8-…`. Prefixing it again produced `apple:apple:…`.
      sourceRef: row.id,
      capturedAt: new Date(row.endDate * 1000),
      activityType: type,
      fixes,
    });
  }

  return { outings, considered: rows.length, maxStart };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

interface PreparedClaim {
  outing: Outing;
  ringIndex: number;
  ring: QualifiedRing;
}

/**
 * Every cell an outing's rings and path touched.
 *
 * `detectLoops` cleans; `trampledTiles` DOES NOT — it rasterises exactly the
 * fixes it is handed, by design, because its own two constants are about the
 * sampling gap and nothing else. So the trample runs over `loops.segments`,
 * which is the cleaned output detectLoops already produced, rather than over
 * the raw fixes.
 *
 * That is a correctness requirement, not a saving. Handed the raw fixes,
 * trample honours no accuracy gate, no mode gate and no speed gate: the school
 * run in the car painted a weight-1 line down every road it used, at 1/3 the
 * score of a loop but over a hundred times the ground, and "driving never
 * captures" was true of claims only. Cleaning first also makes a
 * caller-supplied `excludedActivityTypes` mean the same thing on both halves.
 *
 * Cleaning cannot make the painted line sparser than the raw one at this
 * resolution — the decimation floor is 10 m against a 44 m cell — so the only
 * cells lost are the ones a gate says were never legitimately visited.
 */
function tilesOf(outing: Outing, th: Partial<GeoThresholds> | undefined) {
  const loops = detectLoops(outing.fixes, th);

  const tiles: Tile[] = [];
  const seen = new Set<string>();
  let refusedLegs = 0;
  /** The same cells, kept SEPARATED by cleaned segment — the unit the accuracy,
   *  vehicle, speed, activity-type and observation-gap gates actually cut on.
   *  The interior fill needs them apart; everything else wants them unioned. */
  const perSegment: Tile[][] = [];
  for (const segment of loops.segments) {
    const t = trampledTiles(segment, th);
    refusedLegs += t.refusedLegs;
    perSegment.push(t.tiles);
    for (const tile of t.tiles) {
      const key = tileKeyOf(tile.x, tile.y);
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push(tile);
    }
  }

  return { loops, trample: { tiles, refusedLegs }, perSegment };
}

/**
 * Every ledger event already recorded on these cells, grouped by cell.
 *
 * This is the raw material for `tiles_taken`, and reading the LEDGER rather
 * than geo_tile_state is the whole point.
 *
 * The obvious implementation asks geo_tile_state who owns each cell, once,
 * before anything is written. It is wrong in exactly the case the feature was
 * built for. Decision 19 bills week one as "the founding land grab": every
 * subject's history arrives in ONE full run, so John's July walk and Katie's
 * August walk over the same square are both in the same batch, and a map read
 * before any of it was written says nobody owned anything. Both claims then
 * record `{"unclaimed": 81}` while geo_tile_state correctly reports the
 * handover on all 100 contested cells — and because claims are written
 * ON CONFLICT DO NOTHING, no later run ever repairs it. The capture feed, whose
 * entire job is to say who you took ground from, would report that after the
 * launch backfill every claim landed on virgin land. The ordinary case is the
 * same shape: two family members' journeys arriving in one hourly tick.
 *
 * Resolving each claim against the ledger as at the instant before it landed
 * fixes both, and makes `tiles_taken` a pure function of geo_capture_events —
 * the same property that keeps `previous_owner` rebuild-stable.
 */
async function ledgerByTile(tiles: Iterable<Tile>): Promise<Map<string, CaptureEvent[]>> {
  const keys = [...tiles];
  const out = new Map<string, CaptureEvent[]>();
  for (let i = 0; i < keys.length; i += TILE_BATCH) {
    const chunk = keys.slice(i, i + TILE_BATCH);
    if (!chunk.length) continue;
    const rows = await db
      .select({
        subject: geoCaptureEvents.subject,
        tileX: geoCaptureEvents.tileX,
        tileY: geoCaptureEvents.tileY,
        day: geoCaptureEvents.day,
        kind: geoCaptureEvents.kind,
        weight: geoCaptureEvents.weight,
        capturedAt: geoCaptureEvents.capturedAt,
      })
      .from(geoCaptureEvents)
      .where(tilePredicate(geoCaptureEvents.tileX, geoCaptureEvents.tileY, chunk));
    for (const r of rows) addToTile(out, { ...r, kind: r.kind as CaptureKind });
  }
  return out;
}

function addToTile(map: Map<string, CaptureEvent[]>, e: CaptureEvent) {
  const key = tileKeyOf(e.tileX, e.tileY);
  const held = map.get(key);
  if (held) held.push(e);
  else map.set(key, [e]);
}

/**
 * `(tile_x, tile_y) IN ((1,2),(3,4),…)` — a row-value IN, which Postgres can
 * drive off the composite index. Chunked by the caller.
 *
 * Columns are `AnyPgColumn` rather than one table's own, because BOTH callers
 * matter and they are on different tables: `priorOwners` asks geo_tile_state
 * who held these cells, and `recomputeTiles` asks geo_capture_events what ever
 * happened on them. Pinning the parameter to either table's column type is a
 * type error at the other call site, and drizzle's inferred column types carry
 * their table name, so it is not the sort of error a cast quietly papers over.
 */
function tilePredicate(xCol: AnyPgColumn, yCol: AnyPgColumn, tiles: Tile[]) {
  const pairs = tiles.map((t) => sql`(${t.x}::int, ${t.y}::int)`);
  return sql`(${xCol}, ${yCol}) in (${sql.join(pairs, sql`, `)})`;
}

function bboxOfRing(ring: Array<[number, number]>) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lon, lat] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Insert claims, skipping any that are already there.
 *
 * ON CONFLICT DO NOTHING on (subject, source_kind, source_ref, ring_index),
 * which is a function of the INPUT — so the second run of an unchanged corpus
 * writes nothing and, crucially, does not REWRITE `tiles_taken` with a state
 * that its own first run created.
 */
async function writeClaims(prepared: PreparedClaim[], ledger: Map<string, CaptureEvent[]>) {
  if (!prepared.length) return { attempted: 0, written: 0, claimIdByKey: new Map<string, number>() };

  const values = prepared.map(({ outing, ringIndex, ring }) => {
    const taken = tilesTakenBy(outing, ring.tiles, ledger);
    const bb = bboxOfRing(ring.ring);
    return {
      subject: outing.subject,
      capturedAt: outing.capturedAt,
      day: utcDay(outing.capturedAt),
      sourceKind: outing.sourceKind,
      sourceRef: outing.sourceRef,
      activityType: outing.activityType,
      ringIndex,
      ring: ring.ring,
      polyline: encodePolyline(ring.ring.map(([lon, lat]) => [lat, lon] as [number, number])),
      closure: ring.closure,
      areaM2: ring.areaM2,
      capturedAreaM2: ring.capturedAreaM2,
      widthM: ring.widthM,
      tileCount: ring.tiles.length,
      tilesTaken: taken,
      ...bb,
    };
  });

  let written = 0;
  for (let i = 0; i < values.length; i += INSERT_BATCH) {
    const rows = await db
      .insert(geoClaims)
      .values(values.slice(i, i + INSERT_BATCH))
      .onConflictDoNothing()
      .returning({ id: geoClaims.id });
    written += rows.length;
  }

  // Read the ids back for EVERY prepared claim, not just the ones this run
  // inserted — a re-run has to stamp its trample-free loop events with the same
  // claim_id the first run used.
  const claimIdByKey = new Map<string, number>();
  for (let i = 0; i < prepared.length; i += INSERT_BATCH) {
    const chunk = prepared.slice(i, i + INSERT_BATCH);
    const refs = [...new Set(chunk.map((p) => p.outing.sourceRef))];
    const rows = await db
      .select({
        id: geoClaims.id,
        subject: geoClaims.subject,
        sourceKind: geoClaims.sourceKind,
        sourceRef: geoClaims.sourceRef,
        ringIndex: geoClaims.ringIndex,
      })
      .from(geoClaims)
      .where(inArray(geoClaims.sourceRef, refs));
    for (const r of rows) {
      claimIdByKey.set(`${r.subject}|${r.sourceKind}|${r.sourceRef}|${r.ringIndex}`, r.id);
    }
  }

  return { attempted: values.length, written, claimIdByKey };
}

/**
 * Who held each of a ring's cells in the instant before this claim landed.
 *
 * The same question `ownerBefore` asks of geo_tile_state, asked of a claim: one
 * replay of the cells' events with the horizon set 1 ms before `capturedAt`.
 * Cells whose evidence all post-dates the claim have no owner yet and count as
 * `unclaimed`; cells the claimant already held are not "taken" from anyone and
 * are skipped, which is what makes a re-walk of your own ground record nothing.
 *
 * `ledger` holds the events already in the database PLUS the ones this run is
 * about to write, so a displacement inside a single run is visible. The union
 * is the final ledger for these cells, which is why a full rebuild into an
 * empty geo_claims recomputes the identical value.
 */
function tilesTakenBy(
  outing: Outing,
  tiles: Tile[],
  ledger: Map<string, CaptureEvent[]>,
): Record<string, number> {
  const priorMs = outing.capturedAt.getTime() - 1;
  const relevant: CaptureEvent[] = [];
  for (const t of tiles) {
    for (const e of ledger.get(tileKeyOf(t.x, t.y)) ?? []) {
      if (e.capturedAt.getTime() <= priorMs) relevant.push(e);
    }
  }
  const owners = resolveOwnership(relevant, new Date(priorMs));

  const taken: Record<string, number> = {};
  for (const t of tiles) {
    const owner = owners.get(tileKeyOf(t.x, t.y))?.owner ?? 'unclaimed';
    if (owner === outing.subject) continue;
    taken[owner] = (taken[owner] ?? 0) + 1;
  }
  return taken;
}

interface LedgerRow extends CaptureEvent {
  claimId: number | null;
  sourceKind: string;
  sourceRef: string;
  /** The filter dimension. Null for trail, the declared type for a workout.
   *  NOT part of the uniqueness key — see the column comment in schema.ts. */
  activityType: string | null;
}

/**
 * Append to the ledger.
 *
 * ON CONFLICT DO NOTHING against geo_capture_events_unique_idx. Two jobs in one
 * clause: the anti-farming rule (ten laps of the garden score once) and
 * idempotency (a re-run changes nothing). The EARLIEST row wins, matching
 * dedupeEvents() — if the database kept the latest instead, a rebuild would
 * score a multi-lap day fractionally higher than the live ingest did.
 */
async function writeEvents(rows: LedgerRow[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const inserted = await db
      .insert(geoCaptureEvents)
      .values(rows.slice(i, i + INSERT_BATCH))
      .onConflictDoNothing()
      .returning({ id: geoCaptureEvents.id });
    written += inserted.length;
  }
  return written;
}

/**
 * Recompute ownership for the cells this run touched, and only those.
 *
 * The full ledger for a touched cell is read — not just this run's events —
 * because the decayed score of a cell depends on everything that ever happened
 * on it. The saving is in the cell COUNT, which is what actually grows.
 *
 * `previous_owner` is derived from the LEDGER, not from the row being
 * overwritten. The obvious implementation — "whatever this materialised row
 * said before I changed it" — is wrong in two ways that only show up later: a
 * full rebuild into an empty geo_tile_state loses every handover ever recorded,
 * and a handover that happens inside a single run (the big loop and the block
 * walk arriving in the same hour, or any backfill) is invisible because there
 * was no previous row to read. Replaying the same cell's events at the instant
 * before the current owner took it answers the question properly, costs no
 * extra query — the events are already in memory — and makes the column a pure
 * function of the ledger, which is what keeps a re-run identical.
 */
export async function recomputeTiles(
  tiles: Tile[],
  now: Date,
): Promise<{ touched: number; written: number }> {
  const unique = new Map<string, Tile>();
  for (const t of tiles) unique.set(tileKeyOf(t.x, t.y), t);
  const list = [...unique.values()];
  if (!list.length) return { touched: 0, written: 0 };

  let written = 0;

  for (let i = 0; i < list.length; i += TILE_BATCH) {
    const chunk = list.slice(i, i + TILE_BATCH);

    const rows = await db
      .select({
        subject: geoCaptureEvents.subject,
        tileX: geoCaptureEvents.tileX,
        tileY: geoCaptureEvents.tileY,
        day: geoCaptureEvents.day,
        kind: geoCaptureEvents.kind,
        weight: geoCaptureEvents.weight,
        capturedAt: geoCaptureEvents.capturedAt,
      })
      .from(geoCaptureEvents)
      .where(tilePredicate(geoCaptureEvents.tileX, geoCaptureEvents.tileY, chunk));

    const events: CaptureEvent[] = rows.map((e) => ({
      subject: e.subject,
      tileX: e.tileX,
      tileY: e.tileY,
      day: e.day,
      kind: e.kind as CaptureKind,
      weight: e.weight,
      capturedAt: e.capturedAt,
    }));

    const byTile = new Map<string, CaptureEvent[]>();
    for (const e of events) {
      const key = tileKeyOf(e.tileX, e.tileY);
      const held = byTile.get(key);
      if (held) held.push(e);
      else byTile.set(key, [e]);
    }

    const owned = resolveOwnership(events, now);
    if (!owned.size) continue;

    const values = [...owned.entries()].map(([key, o]) => ({
      tileX: o.tileX,
      tileY: o.tileY,
      ownerSubject: o.owner,
      ownerScore: o.score,
      ownerSince: o.ownerSince,
      lastEventAt: o.lastEventAt,
      previousOwner: ownerBefore(byTile.get(key) ?? [], key, o.ownerSince, o.owner),
      runnerUp: o.runnerUp,
      runnerUpScore: o.runnerUpScore,
      updatedAt: now,
    }));

    for (let j = 0; j < values.length; j += INSERT_BATCH) {
      const slice = values.slice(j, j + INSERT_BATCH);
      await db
        .insert(geoTileState)
        .values(slice)
        .onConflictDoUpdate({
          target: [geoTileState.tileX, geoTileState.tileY],
          set: {
            ownerSubject: sql`excluded.owner_subject`,
            ownerScore: sql`excluded.owner_score`,
            ownerSince: sql`excluded.owner_since`,
            lastEventAt: sql`excluded.last_event_at`,
            previousOwner: sql`excluded.previous_owner`,
            runnerUp: sql`excluded.runner_up`,
            runnerUpScore: sql`excluded.runner_up_score`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
      written += slice.length;
    }
  }

  return { touched: list.length, written };
}

/**
 * Who held this cell in the instant before the current owner took it, or null
 * if nobody did.
 *
 * A replay of the same cell's events with the horizon set one millisecond
 * before the handover. `ownerSince` is the first event at which the current
 * owner led, so everything strictly before it is the prior regime; if that
 * regime had the same leader, the cell never changed hands and the answer is
 * null rather than a repeat of the owner's own name.
 */
function ownerBefore(
  events: CaptureEvent[],
  key: string,
  ownerSince: Date,
  owner: string,
): string | null {
  const priorMs = ownerSince.getTime() - 1;
  const before = events.filter((e) => e.capturedAt.getTime() <= priorMs);
  if (!before.length) return null;
  const prior = resolveOwnership(before, new Date(priorMs)).get(key);
  if (!prior || prior.owner === owner) return null;
  return prior.owner;
}

// ---------------------------------------------------------------------------
// The ingest
// ---------------------------------------------------------------------------

/**
 * Read what is new in both corpora, write the ledger, recompute the cells it
 * touched, advance the watermarks.
 *
 * Safe to run at any cadence and safe to run twice: the second run reads the
 * same ground (the watermark overlap guarantees it re-reads the boundary) and
 * writes nothing.
 */
export async function ingestGeoTerritory(options: IngestOptions = {}): Promise<IngestReport> {
  const startedMs = Date.now();
  const now = options.now ?? new Date();
  const th = resolveThresholds(options.thresholds);
  const includeWorkouts = options.includeWorkouts !== false;

  const subjects = options.subjects?.length ? [...options.subjects].sort() : await trailSubjects();

  const outings: Outing[] = [];
  const perSubject: SubjectIngestReport[] = [];
  const watermarkWrites: Array<() => Promise<void>> = [];

  for (const subject of subjects) {
    const key = trailWatermarkKey(subject);
    const stored = options.full ? new Date(GEO_EPOCH) : await readWatermark(key);
    const floor = options.since && options.since.getTime() < stored.getTime() ? options.since : stored;
    const from = new Date(floor.getTime() - WATERMARK_OVERLAP_MS);

    const rows = await readTrail(subject, from, now, th);
    const mine = outingsFromTrail(rows);
    outings.push(...mine);

    const maxTs = rows.length ? rows[rows.length - 1].ts : now;
    const to = maxTs.getTime() > now.getTime() ? now : maxTs;
    perSubject.push({
      subject,
      fixesRead: rows.length,
      journeys: mine.length,
      claims: 0,
      eventsProposed: 0,
      watermarkFrom: stored.toISOString(),
      watermarkTo: to.toISOString(),
    });
    // Deferred: a watermark advanced before the writes succeed would skip the
    // ground this run failed to record.
    watermarkWrites.push(async () => {
      const written = await advanceWatermark(key, to, options.full ? new Date(GEO_EPOCH) : stored);
      const entry = perSubject.find((p) => p.subject === subject);
      if (entry) entry.watermarkTo = written;
    });
  }

  const workoutReport: IngestReport['workouts'] = {
    considered: 0,
    claims: 0,
    eventsProposed: 0,
    watermarkFrom: GEO_EPOCH,
    watermarkTo: GEO_EPOCH,
  };

  if (includeWorkouts) {
    const key = workoutWatermarkKey(WORKOUT_SUBJECT);
    const stored = options.full ? new Date(GEO_EPOCH) : await readWatermark(key);
    const floor = options.since && options.since.getTime() < stored.getTime() ? options.since : stored;
    const from = new Date(floor.getTime() - WATERMARK_OVERLAP_MS);

    const { outings: workoutOutings, considered, maxStart } = await readWorkoutOutings(from, now, th);
    outings.push(...workoutOutings);
    workoutReport.considered = considered;
    workoutReport.watermarkFrom = stored.toISOString();
    const to = maxStart.getTime() > now.getTime() ? now : maxStart;
    watermarkWrites.push(async () => {
      workoutReport.watermarkTo = await advanceWatermark(
        key,
        to,
        options.full ? new Date(GEO_EPOCH) : stored,
      );
    });
  }

  // ── geometry ────────────────────────────────────────────────────────────
  //
  // Run ONCE per outing. detectLoops and trampledTiles each re-clean the fixes,
  // and calling the pair twice would double the cost of the hourly job for a
  // result that is identical by construction.
  const prepared: PreparedClaim[] = [];
  const trampleByOuting: Array<{ outing: Outing; tiles: Tile[] }> = [];
  const fillByOuting: Array<{ outing: Outing; tiles: Tile[] }> = [];
  const fills: FillResult[] = [];
  const touched = new Map<string, Tile>();

  for (const outing of outings) {
    const { loops, trample, perSegment } = tilesOf(outing, options.thresholds);

    loops.rings.forEach((ring, ringIndex) => {
      prepared.push({ outing, ringIndex, ring });
      for (const t of ring.tiles) touched.set(tileKeyOf(t.x, t.y), t);
    });
    trampleByOuting.push({ outing, tiles: trample.tiles });
    for (const t of trample.tiles) touched.set(tileKeyOf(t.x, t.y), t);

    // ── the interior of what this journey encircled ───────────────────────
    //
    // Fed the journey's WHOLE captured cell set — rings and path unioned —
    // rather than the path alone, and both halves of that matter.
    //
    // Including the ring cells is what stops fill from double-paying a loop:
    // a journey that closed has already had its middle stamped weight 3, so
    // handing fill a solid blob leaves it nothing to enclose. Including the
    // path is the entire feature: 82% of real tracks never close, their ring
    // list is empty, and the snail trail is all there is to work with.
    //
    // SEGMENT BY SEGMENT, not over the outing's union. `cleanJourney` cuts a
    // journey at a vehicle leg, a speed-gate breach or a hole in the record,
    // and a fill over the union welds those pieces back together: a fast
    // circuit whose every leg the 25 km/h gate refused still leaves an
    // unbroken chain of fix cells around the block, and the flood pays out its
    // whole middle at weight 3. See fillInteriorOfSegments. The CEILING is
    // still the journey's — it is applied to the union at the end — so a
    // journey the gates cut in two gets one allowance, not two.
    const fillParts = perSegment.map((tiles, i) => [
      ...tiles,
      ...loops.rings.filter((r) => r.segmentIndex === i).flatMap((r) => r.tiles),
    ]);
    const fill = fillInteriorOfSegments(fillParts, {
      radiusCells: loops.thresholds.fillRadiusCells,
      maxFillTiles: loops.thresholds.maxFillTiles,
    });
    fills.push(fill);
    if (fill.tiles.length) {
      fillByOuting.push({ outing, tiles: fill.tiles });
      for (const t of fill.tiles) touched.set(tileKeyOf(t.x, t.y), t);
    }
  }

  // ── the ledger view ─────────────────────────────────────────────────────
  //
  // What is already recorded on these cells, PLUS what this run is about to
  // record. `tiles_taken` is resolved against it, so a claim that displaces
  // another claim ingested in the same run names its victim instead of
  // reporting virgin land — which is every backfill and every hour in which two
  // family members' journeys arrive together.
  //
  // The events therefore have to be built BEFORE the claims are written, and
  // the claim ids are stamped on afterwards. Nothing else needs a claim id, and
  // a loop event is a pure function of its ring, so nothing is lost by the
  // reordering.
  const ledger = await ledgerByTile(touched.values());

  const loopGroups: Array<{ prepared: PreparedClaim; rows: LedgerRow[] }> = [];
  for (const p of prepared) {
    const rows = captureEvents(
      p.outing.subject,
      p.ring.tiles,
      p.outing.capturedAt,
      'loop',
    ).map((e) => ({
      ...e,
      claimId: null as number | null,
      sourceKind: p.outing.sourceKind,
      sourceRef: p.outing.sourceRef,
      activityType: p.outing.activityType,
    }));
    loopGroups.push({ prepared: p, rows });
    for (const e of rows) addToTile(ledger, e);
  }

  const trampleEvents: LedgerRow[] = [];
  for (const { outing, tiles: trampled } of trampleByOuting) {
    for (const e of captureEvents(outing.subject, trampled, outing.capturedAt, 'trample')) {
      const row: LedgerRow = {
        ...e,
        claimId: null,
        sourceKind: outing.sourceKind,
        sourceRef: outing.sourceRef,
        activityType: outing.activityType,
      };
      trampleEvents.push(row);
      addToTile(ledger, row);
    }
  }

  // Fill events are built alongside trample: they carry no claim id (the
  // journey that produced them usually has no ring at all — that is the whole
  // point) and they are stamped with the same source and activity type, so the
  // existing activity/subject/source filters reach them without a change.
  const fillEvents: LedgerRow[] = [];
  for (const { outing, tiles: filled } of fillByOuting) {
    for (const e of captureEvents(outing.subject, filled, outing.capturedAt, 'fill')) {
      const row: LedgerRow = {
        ...e,
        claimId: null,
        sourceKind: outing.sourceKind,
        sourceRef: outing.sourceRef,
        activityType: outing.activityType,
      };
      fillEvents.push(row);
      addToTile(ledger, row);
    }
  }

  const claims = await writeClaims(prepared, ledger);

  // Loop events carry their claim id; trample events never have one. Stamped
  // here, after the claims exist — and onto the row objects the ledger view
  // already holds, which is harmless because `claim_id` is advisory and plays
  // no part in ownership.
  const loopEvents: LedgerRow[] = [];
  for (const { prepared: p, rows } of loopGroups) {
    const claimId =
      claims.claimIdByKey.get(
        `${p.outing.subject}|${p.outing.sourceKind}|${p.outing.sourceRef}|${p.ringIndex}`,
      ) ?? null;
    for (const row of rows) {
      row.claimId = claimId;
      loopEvents.push(row);
    }
  }

  // Deduplicate in memory FIRST — an INSERT whose own VALUES list contains the
  // same conflict key twice is a "cannot affect row a second time" error on the
  // DO UPDATE path and, even on DO NOTHING, makes the written count a lie.
  // dedupeEvents keeps the EARLIEST, which is exactly what the unique index
  // plus DO NOTHING does at the database; if the two rules disagreed, a rebuild
  // would score a multi-lap day differently from the live ingest.
  const proposed: LedgerRow[] = [
    ...(dedupeEvents(loopEvents) as LedgerRow[]),
    ...(dedupeEvents(trampleEvents) as LedgerRow[]),
    ...(dedupeEvents(fillEvents) as LedgerRow[]),
  ];

  const eventsWritten = await writeEvents(proposed);

  // Attribute the counts back to their subjects for the report.
  for (const entry of perSubject) {
    entry.claims = prepared.filter(
      (p) => p.outing.sourceKind === 'trail' && p.outing.subject === entry.subject,
    ).length;
    entry.eventsProposed = proposed.filter(
      (p) => p.sourceKind === 'trail' && p.subject === entry.subject,
    ).length;
  }
  workoutReport.claims = prepared.filter((p) => p.outing.sourceKind === 'workout').length;
  workoutReport.eventsProposed = proposed.filter((p) => p.sourceKind === 'workout').length;

  const tiles = await recomputeTiles([...touched.values()], now);

  // Watermarks LAST. Advancing one before the writes land would skip whatever
  // the failed run was in the middle of.
  for (const write of watermarkWrites) await write();

  return {
    startedAt: new Date(startedMs).toISOString(),
    now: now.toISOString(),
    full: Boolean(options.full),
    subjects: perSubject,
    workouts: workoutReport,
    tilesTouched: tiles.touched,
    tileRowsWritten: tiles.written,
    claimsWritten: claims.written,
    claimsTotal: prepared.length,
    totalEventsWritten: eventsWritten,
    totalEventsProposed: proposed.length,
    fillEventsProposed: proposed.filter((p) => p.kind === 'fill').length,
    fillTiles: fills.reduce((n, f) => n + f.tiles.length, 0),
    fillOutingsCapped: fills.filter((f) => f.capped || f.bboxOverflow).length,
    fillInteriorRejected: fills.reduce((n, f) => n + (f.capped ? f.interiorFound : 0), 0),
    elapsedMs: Date.now() - startedMs,
  };
}

/**
 * Full rebuild: reset every watermark to the epoch and re-ingest.
 *
 * The ledger is NOT truncated — it is append-only and the unique index makes a
 * replay a no-op. That is the point: a rebuild after a bug fix adds what was
 * missed and cannot double-count what was not.
 */
export async function rebuildGeoTerritory(
  options: Omit<IngestOptions, 'full'> = {},
): Promise<IngestReport> {
  return ingestGeoTerritory({ ...options, full: true });
}

// ---------------------------------------------------------------------------
// Reading territory under a filter
//
// Amendment 1 says cycling captures ground and is filtered at the VIEWING
// layer. Until this section existed only HALF of that was true: activity_type
// made the CELL LIST filterable, but ownership was only ever resolved over the
// unfiltered ledger, so a foot-only view kept cells whose materialised owner
// had earned them solely by bike. Measured: a rider's loop (weight 3) and a
// walker's trample (weight 1) on one cell resolve to owner=rider 2.82,
// runner-up=walker 0.96; apply `activity_type is distinct from 'ride'` to the
// cells and the cell SURVIVES on the walker's evidence while the only owner
// anywhere in the schema is the rider, who has no foot evidence on it at all.
// A renderer that picked cells from the ledger and colours from geo_tile_state
// paints the rider's colour on a walking-only map.
//
// So the page asks ONE question — "who owns this, under this filter" — instead
// of two that disagree. geo_tile_state stays the unfiltered fast path (it is
// what the default view reads); this is the path every other view takes.
// ---------------------------------------------------------------------------

export interface TerritoryFilter {
  /** Activity types to drop. Untyped (trail) rows are KEPT — see below. */
  excludeActivityTypes?: string[];
  /** Restrict to these subjects. Absent means everyone. */
  subjects?: string[];
  /** 'trail' | 'workout'. Absent means both. */
  sourceKinds?: string[];
  /** Drop untyped rows too. Off by default: untyped is the entire Life360
   *  corpus, i.e. four of the five subjects. */
  excludeUntyped?: boolean;
  /**
   * Only count captures at or after this instant — the date window.
   *
   * It belongs HERE, on the same filter every other dimension uses, and not as
   * a separate "hide old cells" pass over the result, because the question a
   * window asks is a counterfactual: "who would own this ground if only the
   * last week counted". Hiding cells cannot answer it. A cell John won in June
   * and Katie trampled on Tuesday is JOHN's on the unfiltered ledger and
   * KATIE's under a seven-day window, and no amount of hiding turns the first
   * answer into the second.
   *
   * The upper bound is `resolveFilteredOwnership`'s `now`, which already exists
   * and is already applied — so a window is a pair (capturedFrom, now) and the
   * caller moves BOTH when it asks the question as at an earlier instant.
   */
  capturedFrom?: Date;
}

/**
 * `activity_type` is not one of these — INCLUDING when it is NULL.
 *
 * The one place this filter is spelled, and it exists because the obvious
 * spelling is silently wrong. `activity_type not in ('ride','mtb')` looks
 * right and is a three-valued-logic trap: this column is NULL for every trail
 * journey (Life360 carries no activity type), `null not in ('ride')` evaluates
 * to NULL rather than true, and a WHERE clause drops the row. So the natural
 * foot-only query deletes the entire Life360 corpus — Katie, Rory, Fintan and
 * Jemima show zero territory while John, whose rows come from Apple and are
 * typed, looks correct. It reads as four broken phones rather than as a query
 * bug, and no test on this box would catch it: the dev corpus has zero NULL
 * rows, so both spellings agree.
 *
 * Same class as the repo's standing rule that a `source` allow-list on
 * daydream_trail silently drops the whole `backfill` corpus.
 *
 * Call this rather than writing the clause. `is distinct from` is the two-value
 * form and `(x is null or x not in (…))` the general one; both are here so that
 * neither has to be remembered.
 */
export function activityTypeNotIn(col: AnyPgColumn, types: string[]) {
  const wanted = [...new Set(types.filter((t) => typeof t === 'string' && t.length > 0))];
  if (!wanted.length) return undefined;
  if (wanted.length === 1) return sql`${col} is distinct from ${wanted[0]}`;
  return sql`(${col} is null or ${col} not in (${sql.join(
    wanted.map((t) => sql`${t}`),
    sql`, `,
  )}))`;
}

/** The WHERE clause a filtered view uses, over geo_capture_events. */
export function territoryFilterSql(filter: TerritoryFilter = {}) {
  const parts = [
    filter.excludeActivityTypes?.length
      ? activityTypeNotIn(geoCaptureEvents.activityType, filter.excludeActivityTypes)
      : undefined,
    filter.excludeUntyped ? isNotNull(geoCaptureEvents.activityType) : undefined,
    filter.subjects?.length ? inArray(geoCaptureEvents.subject, filter.subjects) : undefined,
    filter.sourceKinds?.length ? inArray(geoCaptureEvents.sourceKind, filter.sourceKinds) : undefined,
    filter.capturedFrom ? gte(geoCaptureEvents.capturedAt, filter.capturedFrom) : undefined,
  ].filter((p): p is Exclude<typeof p, undefined> => p !== undefined);
  return parts.length ? and(...parts) : undefined;
}

/**
 * Ownership resolved over the ledger AS FILTERED — the one query a filtered map
 * and a filtered cell list both read.
 *
 * Not materialised, and deliberately: a per-filter geo_tile_state is a schema
 * change and a cache-invalidation problem, and the honest filter space
 * (activity type x source kind x subject) has no small enumeration. Resolving
 * on the fly is a replay over the events on the cells actually in view, which
 * is the same work recomputeTiles already does hourly.
 *
 * With no filter this returns exactly what geo_tile_state holds, so a caller
 * can use the materialised table for the default view and this for every other
 * one without the two ever disagreeing.
 */
export async function resolveFilteredOwnership(options: {
  now?: Date;
  filter?: TerritoryFilter;
  /** Restrict to these cells. Absent means every cell in the ledger. */
  tiles?: Tile[];
  /** Or a cell-space viewport: inclusive bounds at the ledger's zoom. */
  tileRange?: { minX: number; maxX: number; minY: number; maxY: number };
}) {
  const now = options.now ?? new Date();
  const base = territoryFilterSql(options.filter);

  const rows: CaptureEvent[] = [];
  const read = async (extra?: ReturnType<typeof territoryFilterSql>) => {
    const where = [base, extra, lte(geoCaptureEvents.capturedAt, now)].filter(
      (p): p is Exclude<typeof p, undefined> => p !== undefined,
    );
    const got = await db
      .select({
        subject: geoCaptureEvents.subject,
        tileX: geoCaptureEvents.tileX,
        tileY: geoCaptureEvents.tileY,
        day: geoCaptureEvents.day,
        kind: geoCaptureEvents.kind,
        weight: geoCaptureEvents.weight,
        capturedAt: geoCaptureEvents.capturedAt,
      })
      .from(geoCaptureEvents)
      .where(where.length ? and(...where) : undefined);
    for (const r of got) rows.push({ ...r, kind: r.kind as CaptureKind });
  };

  if (options.tiles?.length) {
    for (let i = 0; i < options.tiles.length; i += TILE_BATCH) {
      const chunk = options.tiles.slice(i, i + TILE_BATCH);
      await read(
        and(tilePredicate(geoCaptureEvents.tileX, geoCaptureEvents.tileY, chunk)),
      );
    }
  } else if (options.tileRange) {
    const r = options.tileRange;
    await read(
      and(
        sql`${geoCaptureEvents.tileX} between ${r.minX} and ${r.maxX}`,
        sql`${geoCaptureEvents.tileY} between ${r.minY} and ${r.maxY}`,
      ),
    );
  } else {
    await read();
  }

  return resolveOwnership(rows, now);
}

// ---------------------------------------------------------------------------
// Daily snapshots
// ---------------------------------------------------------------------------

export interface SnapshotRow {
  day: string;
  subject: string;
  tileCount: number;
  areaM2: number;
  regionCount: number;
}

/**
 * Ownership as at the END of one UTC day, written to geo_daily_snapshot.
 *
 * Resolved from the ledger with `now` set to that day's last millisecond rather
 * than read off geo_tile_state, and the difference is the whole reason this
 * table exists. The score decays with AGE, so "who owned this on Sunday" asked
 * on Wednesday is a different question from the one Sunday answered; a weekly
 * gained/lost board built by replaying today's ledger against today's clock
 * would report movement nobody made.
 *
 * Upsert, not insert: recomputing a day from the same ledger gives the same
 * answer, so a re-run is a no-op in effect.
 */
export async function writeDailySnapshot(
  day: string,
  options: { zoom?: number } = {},
): Promise<SnapshotRow[]> {
  const horizon = new Date(`${day}T23:59:59.999Z`);
  if (!Number.isFinite(horizon.getTime())) throw new Error(`bad snapshot day: ${day}`);

  const events = await db
    .select({
      subject: geoCaptureEvents.subject,
      tileX: geoCaptureEvents.tileX,
      tileY: geoCaptureEvents.tileY,
      day: geoCaptureEvents.day,
      kind: geoCaptureEvents.kind,
      weight: geoCaptureEvents.weight,
      capturedAt: geoCaptureEvents.capturedAt,
    })
    .from(geoCaptureEvents)
    .where(lte(geoCaptureEvents.capturedAt, horizon));

  const owned = resolveOwnership(
    events.map((e) => ({
      subject: e.subject,
      tileX: e.tileX,
      tileY: e.tileY,
      day: e.day,
      kind: e.kind as CaptureKind,
      weight: e.weight,
      capturedAt: e.capturedAt,
    })),
    horizon,
  );

  const bySubject = new Map<string, Tile[]>();
  for (const o of owned.values()) {
    const list = bySubject.get(o.owner) ?? [];
    list.push({ x: o.tileX, y: o.tileY });
    bySubject.set(o.owner, list);
  }

  const rows: SnapshotRow[] = [...bySubject.entries()]
    .map(([subject, tiles]) => ({
      subject,
      day,
      tileCount: tiles.length,
      // Cell count x the per-latitude Mercator constant, summed per cell so a
      // territory spanning several degrees is not paid at one latitude's rate.
      areaM2: tiles.reduce(
        (sum, t) => sum + tileAreaM2(tileCentre(t.x, t.y, options.zoom).lat, options.zoom),
        0,
      ),
      regionCount: connectedComponents(tiles).length,
    }))
    .sort((a, b) => (a.subject < b.subject ? -1 : 1));

  if (rows.length) {
    await db
      .insert(geoDailySnapshot)
      .values(rows)
      .onConflictDoUpdate({
        target: [geoDailySnapshot.day, geoDailySnapshot.subject],
        set: {
          tileCount: sql`excluded.tile_count`,
          areaM2: sql`excluded.area_m2`,
          regionCount: sql`excluded.region_count`,
          // REFRESHED on purpose. This column is how rollDailySnapshots knows a
          // day is stale — a capture event created after it means the snapshot
          // never saw that event. A recompute that kept the original stamp
          // would go on reporting itself as stale after it had been repaired,
          // and the roll would recompute the same day forever without ever
          // reaching the next one.
          createdAt: sql`now()`,
        },
      });
  }

  // ABSENCE MEANS ZERO, in both directions. A repair can take a subject's last
  // cell on this day off them — the whole point of a repair is that the answer
  // changed — and an upsert alone would leave their old row standing as a
  // ghost, which the weekly board reads as ground they still held. Delete what
  // the recompute did not produce.
  const held = rows.map((r) => r.subject);
  await db
    .delete(geoDailySnapshot)
    .where(
      held.length
        ? and(eq(geoDailySnapshot.day, day), notInArray(geoDailySnapshot.subject, held))
        : eq(geoDailySnapshot.day, day),
    );

  return rows;
}

// ---------------------------------------------------------------------------

/**
 * The earliest already-written snapshot day that the ledger has since moved
 * under, or null if every snapshot still reflects the evidence.
 *
 * A snapshot for day D answers "who owned what at the end of D" over the events
 * that existed when it was written. A capture event whose own day is <= D but
 * whose `created_at` is LATER than D's snapshot is evidence that snapshot never
 * saw — so D, and every day after it, is now wrong.
 *
 * That is not an edge case. It is Phase 5: merge, backfill katie/fintan/jemima/
 * rory, rebuild. The rebuild repairs the ledger and geo_tile_state, and without
 * this it repairs not one snapshot row — so the weekly gained/lost board would
 * read as though John owned everything for the whole founding week, forever,
 * with no exposed call able to fix it. It is also the ordinary case of a
 * Life360 `gap` or `backfill` fix landing on a day the heartbeat has already
 * rolled past.
 *
 * Returning the earliest such day (rather than a set) is enough because the
 * roll rewrites forward from it: a stale day makes every later day stale too.
 */
async function earliestStaleSnapshotDay(lastDay: string): Promise<string | null> {
  // Raw, because the shape is a correlated EXISTS against an aliased self of
  // another table and drizzle's builder does not express it. The two leading
  // conditions are cheap prefilters that let the planner use
  // geo_capture_events_created_idx instead of walking the whole ledger.
  //
  // Bounded by `lastDay` — the newest day this call is allowed to write — in
  // BOTH the event filter and the EXISTS. A snapshot for a day beyond the
  // horizon (written by an earlier call with a later clock, which is the normal
  // state of a test suite and of any replay with a fixed `now`) is one this
  // call can neither reach nor repair, and counting it made the roll report the
  // same stale day forever while never rewriting it.
  const res = await db.execute<{ day: string | null }>(sql`
    select min(e.day) as day
    from geo_capture_events e
    where e.created_at > (select min(s.created_at) from geo_daily_snapshot s)
      and e.day <= ${lastDay}
      and exists (
        select 1 from geo_daily_snapshot s
        where s.day >= e.day and s.day <= ${lastDay} and s.created_at < e.created_at
      )
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows?: Array<{ day: string | null }> }).rows) ?? [];
  return rows[0]?.day ?? null;
}

/**
 * Write every missing daily snapshot up to yesterday, and rewrite any the
 * ledger has moved under.
 *
 * A ROLLOVER inside the hourly run, never a separate daily job: the heartbeat's
 * active-hours lock-out means a daily action that misses its window skips
 * FOREVER, and short-cadence jobs self-heal. Self-healing is the point of
 * deriving the starting day from the table rather than from a settings key —
 * after an outage this simply fills in what is missing.
 *
 * It heals BACKWARDS as well as forwards. Reading only `max(day) + 1` was a
 * one-way ratchet: ground that arrived for a day already snapshotted was
 * permanently missing from the weekly board, and the only repair was a manual
 * DELETE in psql. `earliestStaleSnapshotDay` reopens exactly those days.
 *
 * Progress is guaranteed even when `maxDays` cannot cover the whole repair,
 * because writeDailySnapshot refreshes `created_at`: the days this call fixes
 * stop being stale, so the next call starts after them rather than at the same
 * place. An hourly heartbeat on the default of 7 walks through a month's repair
 * in five ticks without ever needing to know it is doing so.
 *
 * Today is never snapshotted: the day is not over, and a partial day written
 * under a final day's key is the one row the weekly board cannot detect as
 * wrong.
 */
export async function rollDailySnapshots(
  options: { now?: Date; maxDays?: number; from?: string } = {},
): Promise<{ days: string[]; rows: number; repairedFrom: string | null }> {
  const now = options.now ?? new Date();
  const maxDays = options.maxDays ?? 7;
  const yesterday = new Date(now.getTime() - 86_400_000);
  const lastDay = utcDay(yesterday);

  const [latest] = await db
    .select({ day: geoDailySnapshot.day })
    .from(geoDailySnapshot)
    .orderBy(desc(geoDailySnapshot.day))
    .limit(1);

  const [earliest] = await db
    .select({ capturedAt: geoCaptureEvents.capturedAt })
    .from(geoCaptureEvents)
    .orderBy(asc(geoCaptureEvents.capturedAt))
    .limit(1);

  if (!earliest) return { days: [], rows: 0, repairedFrom: null };

  const nextDay = latest
    ? utcDay(new Date(new Date(`${latest.day}T00:00:00.000Z`).getTime() + 86_400_000))
    : utcDay(earliest.capturedAt);

  // An explicit `from` and a detected stale day both pull the cursor BACK,
  // never forward — a start later than `nextDay` would leave a hole in the
  // series that nothing afterwards would notice.
  const stale = await earliestStaleSnapshotDay(lastDay);
  const candidates = [nextDay, stale, options.from].filter(
    (d): d is string => typeof d === 'string' && d.length > 0,
  );
  const startDay = candidates.sort()[0];
  const floor = utcDay(earliest.capturedAt);
  const cursorStart = startDay < floor ? floor : startDay;

  // A REPAIR runs to the horizon; only the forward fill is capped by `maxDays`.
  //
  // Not a nicety. A half-done repair makes no progress at all: the days it did
  // not reach still carry their old `created_at`, so the same late event is
  // still late relative to them and the next call recomputes the identical
  // range forever. It also leaves the series internally inconsistent, which is
  // the one thing a gained/lost board cannot survive. `maxDays` keeps its real
  // job — bounding the catch-up after an outage — and the repair gets a ceiling
  // of its own so an unbounded loop is still impossible.
  const repairing = cursorStart < nextDay;
  const cap = repairing ? MAX_SNAPSHOT_REPAIR_DAYS : maxDays;

  const days: string[] = [];
  let cursor = cursorStart;
  while (cursor <= lastDay && days.length < cap) {
    days.push(cursor);
    cursor = utcDay(new Date(new Date(`${cursor}T00:00:00.000Z`).getTime() + 86_400_000));
  }

  let rows = 0;
  for (const day of days) rows += (await writeDailySnapshot(day)).length;
  return { days, rows, repairedFrom: stale ?? (options.from ?? null) };
}
