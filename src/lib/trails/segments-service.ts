// Read and write side for intra-route segments.
//
// Mirrors activities-service: server-only, returns plain data, never throws for
// "no rows". The discovery itself lives in $lib/trails/segments and knows
// nothing about a database — everything here is loading, measuring, reconciling
// and storing what it found.

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  activities,
  activitySegmentEfforts,
  activitySegments,
  activitySeries,
  activityTracks,
} from '$lib/db/schema';
import { encodePolyline } from '$lib/health/polyline';
import type { HrSample } from '$lib/health/analytics/series-intervals';
import { trackBounds, type TrackPoint } from './track';
import { resampleTrack } from './segments/resample';
import { discoverSegments, type DiscoveredSegment, type MatchOptions } from './segments/matcher';
import { makeCorridor, corridorMatch, type LngLat } from './segments/corridor';
import { effortMetrics } from './segments/metrics';
import { segmentDescriptor, segmentName, segmentSeed } from './segments/naming';

export type SegmentGeometry = Array<[number, number, number | null, number]>;

export interface SegmentListRow {
  id: number;
  name: string;
  activityType: string;
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  effortCount: number;
  firstEffortAt: number | null;
  lastEffortAt: number | null;
  polyline: string | null;
  descriptor: string;
}

export interface SegmentEffortRow {
  id: number;
  activityId: string;
  activityName: string;
  activityType: string;
  startDateLocal: string;
  startedAt: number;
  lapIndex: number;
  durationS: number;
  distanceM: number;
  speedMps: number;
  paceSPerKm: number;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  elevationGainM: number | null;
  efficiencyFactor: number | null;
  beatsPerKm: number | null;
}

export interface SegmentDetail extends SegmentListRow {
  coordinates: SegmentGeometry;
  bounds: { n: number; s: number; e: number; w: number } | null;
  efforts: SegmentEffortRow[];
}

/** A segment as it appears on the page of one activity that ran it. */
export interface ActivitySegmentRow {
  segmentId: number;
  name: string;
  descriptor: string;
  polyline: string | null;
  segmentDistanceM: number;
  effortCount: number;
  effort: SegmentEffortRow;
  /** 1-based, against every effort on the segment. Null where unrankable. */
  rankByTime: number | null;
  rankByEfficiency: number | null;
}

type SegmentListSource = Omit<
  typeof activitySegments.$inferSelect,
  'coordinates' | 'bounds' | 'pointCount' | 'updatedAt'
>;

function toListRow(row: SegmentListSource): SegmentListRow {
  return {
    id: row.id,
    name: row.name,
    activityType: row.activityType,
    distanceM: row.distanceM,
    elevationGainM: row.elevationGainM,
    elevationLossM: row.elevationLossM,
    effortCount: row.effortCount,
    firstEffortAt: row.firstEffortAt,
    lastEffortAt: row.lastEffortAt,
    polyline: row.polyline,
    descriptor: segmentDescriptor({
      distanceM: row.distanceM,
      elevationGainM: row.elevationGainM,
      elevationLossM: row.elevationLossM,
      effortCount: row.effortCount,
    }),
  };
}

export interface SegmentListResult {
  rows: SegmentListRow[];
  types: Array<{ activityType: string; count: number }>;
}

export async function listSegments(
  opts: { types?: string[]; limit?: number } = {},
): Promise<SegmentListResult> {
  const { types, limit = 200 } = opts;
  const where = types?.length ? inArray(activitySegments.activityType, types) : undefined;

  // Explicit projection, not select(): `coordinates` holds every point of every
  // segment, so selecting it here would drag megabytes of jsonb off the
  // database for a list that renders the encoded polyline instead.
  const rows = await db
    .select({
      id: activitySegments.id,
      name: activitySegments.name,
      activityType: activitySegments.activityType,
      distanceM: activitySegments.distanceM,
      elevationGainM: activitySegments.elevationGainM,
      elevationLossM: activitySegments.elevationLossM,
      effortCount: activitySegments.effortCount,
      firstEffortAt: activitySegments.firstEffortAt,
      lastEffortAt: activitySegments.lastEffortAt,
      polyline: activitySegments.polyline,
    })
    .from(activitySegments)
    .where(where)
    // Busiest first: the ground you cover most is the ground worth comparing.
    .orderBy(desc(activitySegments.effortCount), desc(activitySegments.distanceM))
    .limit(limit);

  const typeCounts = await db
    .select({
      activityType: activitySegments.activityType,
      count: sql<number>`count(*)::int`,
    })
    .from(activitySegments)
    .groupBy(activitySegments.activityType)
    .orderBy(desc(sql`count(*)`));

  return { rows: rows.map(toListRow), types: typeCounts };
}

async function effortsForSegments(segmentIds: number[]): Promise<Map<number, SegmentEffortRow[]>> {
  const out = new Map<number, SegmentEffortRow[]>();
  if (!segmentIds.length) return out;

  const rows = await db
    .select({
      id: activitySegmentEfforts.id,
      segmentId: activitySegmentEfforts.segmentId,
      activityId: activitySegmentEfforts.activityId,
      startedAt: activitySegmentEfforts.startedAt,
      lapIndex: activitySegmentEfforts.lapIndex,
      durationS: activitySegmentEfforts.durationS,
      distanceM: activitySegmentEfforts.distanceM,
      speedMps: activitySegmentEfforts.speedMps,
      paceSPerKm: activitySegmentEfforts.paceSPerKm,
      avgHeartrate: activitySegmentEfforts.avgHeartrate,
      maxHeartrate: activitySegmentEfforts.maxHeartrate,
      elevationGainM: activitySegmentEfforts.elevationGainM,
      efficiencyFactor: activitySegmentEfforts.efficiencyFactor,
      beatsPerKm: activitySegmentEfforts.beatsPerKm,
      activityName: activities.name,
      activityType: activities.activityType,
      startDateLocal: activities.startDateLocal,
    })
    .from(activitySegmentEfforts)
    .innerJoin(activities, eq(activities.id, activitySegmentEfforts.activityId))
    .where(inArray(activitySegmentEfforts.segmentId, segmentIds))
    .orderBy(desc(activitySegmentEfforts.startedAt));

  for (const row of rows) {
    const { segmentId, ...effort } = row;
    const bucket = out.get(segmentId);
    if (bucket) bucket.push(effort);
    else out.set(segmentId, [effort]);
  }
  return out;
}

export async function getSegment(id: number): Promise<SegmentDetail | null> {
  const [segment] = await db
    .select()
    .from(activitySegments)
    .where(eq(activitySegments.id, id))
    .limit(1);
  if (!segment) return null;

  const efforts = (await effortsForSegments([id])).get(id) ?? [];
  return {
    ...toListRow(segment),
    coordinates: (segment.coordinates as SegmentGeometry) ?? [],
    bounds: (segment.bounds as SegmentDetail['bounds']) ?? null,
    efforts,
  };
}

/**
 * Segments this activity ran, with its own effort and where that effort sits.
 *
 * Ranks are computed against every effort on the segment, not just this
 * activity's — "3rd fastest of 11" is the only version of that sentence worth
 * printing.
 */
export async function getActivitySegments(activityId: string): Promise<ActivitySegmentRow[]> {
  const mine = await db
    .select({ segmentId: activitySegmentEfforts.segmentId })
    .from(activitySegmentEfforts)
    .where(eq(activitySegmentEfforts.activityId, activityId));
  const segmentIds = [...new Set(mine.map((r) => r.segmentId))];
  if (!segmentIds.length) return [];

  const segments = await db
    .select({
      id: activitySegments.id,
      name: activitySegments.name,
      distanceM: activitySegments.distanceM,
      elevationGainM: activitySegments.elevationGainM,
      elevationLossM: activitySegments.elevationLossM,
      effortCount: activitySegments.effortCount,
      polyline: activitySegments.polyline,
    })
    .from(activitySegments)
    .where(inArray(activitySegments.id, segmentIds));
  const allEfforts = await effortsForSegments(segmentIds);

  const out: ActivitySegmentRow[] = [];
  for (const segment of segments) {
    const efforts = allEfforts.get(segment.id) ?? [];
    const ours = efforts.filter((e) => e.activityId === activityId);
    if (!ours.length) continue;

    const byTime = [...efforts].sort((a, b) => a.durationS - b.durationS);
    const byEf = efforts
      .filter((e) => e.efficiencyFactor != null)
      .sort((a, b) => (b.efficiencyFactor ?? 0) - (a.efficiencyFactor ?? 0));

    for (const effort of ours) {
      const timeIdx = byTime.findIndex((e) => e.id === effort.id);
      const efIdx = byEf.findIndex((e) => e.id === effort.id);
      out.push({
        segmentId: segment.id,
        name: segment.name,
        descriptor: segmentDescriptor({
          distanceM: segment.distanceM,
          elevationGainM: segment.elevationGainM,
          elevationLossM: segment.elevationLossM,
          effortCount: segment.effortCount,
        }),
        polyline: segment.polyline,
        segmentDistanceM: segment.distanceM,
        effortCount: segment.effortCount,
        effort,
        rankByTime: timeIdx >= 0 ? timeIdx + 1 : null,
        rankByEfficiency: efIdx >= 0 ? efIdx + 1 : null,
      });
    }
  }

  return out.sort((a, b) => b.segmentDistanceM - a.segmentDistanceM);
}

// --- rebuild ----------------------------------------------------------------

export interface RebuildReport {
  activitiesConsidered: number;
  segments: number;
  efforts: number;
  created: number;
  kept: number;
  removed: number;
  notes: string[];
  elapsedMs: number;
}

interface PreparedEffort {
  activityId: string;
  startS: number;
  endS: number;
  distanceM: number;
  elevationGainM: number;
  startedAt: number;
  metrics: NonNullable<ReturnType<typeof effortMetrics>>;
}

interface PreparedSegment {
  activityType: string;
  coordinates: SegmentGeometry;
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  efforts: PreparedEffort[];
}

/**
 * Recompute every segment from scratch.
 *
 * Cheap enough to be the ONLY path: at the size this dataset runs to, a full
 * rebuild takes a few seconds, and a second incremental algorithm that has to
 * agree with this one would be a permanent source of drift for no gain.
 */
export async function rebuildSegments(options: MatchOptions = {}): Promise<RebuildReport> {
  const startedMs = Date.now();

  const tracked = await db
    .select({
      id: activities.id,
      activityType: activities.activityType,
      startDate: activities.startDate,
      coordinates: activityTracks.coordinates,
    })
    .from(activities)
    .innerJoin(activityTracks, eq(activityTracks.activityId, activities.id))
    .orderBy(asc(activities.startDate));

  const sources = tracked
    .map((row) => ({
      activityId: row.id,
      activityType: row.activityType,
      startDate: row.startDate,
      track: resampleTrack((row.coordinates as TrackPoint[]) ?? []),
    }))
    .filter((s) => s.track.n > 1);

  const { segments: discovered, notes } = discoverSegments(sources, options);
  const startDates = new Map(sources.map((s) => [s.activityId, s.startDate]));

  // Heart rate only for the activities that actually contributed an effort.
  const needed = [...new Set(discovered.flatMap((s) => s.efforts.map((e) => e.activityId)))];
  const hrByActivity = new Map<string, HrSample[]>();
  if (needed.length) {
    const rows = await db
      .select({ activityId: activitySeries.activityId, samples: activitySeries.samples })
      .from(activitySeries)
      .where(
        and(eq(activitySeries.metric, 'heart_rate'), inArray(activitySeries.activityId, needed)),
      );
    for (const row of rows) hrByActivity.set(row.activityId, row.samples as HrSample[]);
  }

  const prepared = discovered
    .map((segment) => prepareSegment(segment, hrByActivity, startDates))
    .filter((s): s is PreparedSegment => s != null);

  const written = await persistSegments(prepared);

  return {
    activitiesConsidered: sources.length,
    segments: prepared.length,
    efforts: prepared.reduce((n, s) => n + s.efforts.length, 0),
    ...written,
    notes,
    elapsedMs: Date.now() - startedMs,
  };
}

function prepareSegment(
  segment: DiscoveredSegment,
  hrByActivity: Map<string, HrSample[]>,
  startDates: Map<string, number>,
): PreparedSegment | null {
  const efforts: PreparedEffort[] = [];

  for (const effort of segment.efforts) {
    const metrics = effortMetrics({
      startS: effort.startS,
      endS: effort.endS,
      distanceM: effort.distanceM,
      hrSamples: hrByActivity.get(effort.activityId) ?? null,
    });
    // An effort we cannot time or measure is not evidence of anything.
    if (!metrics) continue;

    efforts.push({
      activityId: effort.activityId,
      startS: Math.round(effort.startS * 10) / 10,
      endS: Math.round(effort.endS * 10) / 10,
      distanceM: effort.distanceM,
      elevationGainM: effort.elevationGainM,
      startedAt: (startDates.get(effort.activityId) ?? 0) + Math.round(effort.startS),
      metrics,
    });
  }

  if (efforts.length < 2) return null;
  efforts.sort((a, b) => a.startedAt - b.startedAt);

  return {
    activityType: segment.activityType,
    coordinates: segment.coordinates,
    distanceM: segment.distanceM,
    elevationGainM: segment.elevationGainM,
    elevationLossM: segment.elevationLossM,
    efforts,
  };
}

/**
 * Write the recomputed set over the stored one, matching by geometry.
 *
 * A recomputed segment that lands on the same ground as a stored one inherits
 * its row — id and, more importantly, name. Without this, every rebuild would
 * rename every place you had learned, because the reference trace a stretch
 * happens to be measured from can change when a new activity lands.
 */
async function persistSegments(
  prepared: PreparedSegment[],
): Promise<{ created: number; kept: number; removed: number }> {
  const stored = await db
    .select({
      id: activitySegments.id,
      name: activitySegments.name,
      activityType: activitySegments.activityType,
      coordinates: activitySegments.coordinates,
    })
    .from(activitySegments);

  const corridors = stored.map((row) => ({
    ...row,
    points: ((row.coordinates as SegmentGeometry) ?? []).map(
      ([lng, lat]) => [lng, lat] as LngLat,
    ),
  }));

  const takenNames = new Set(stored.map((s) => s.name));
  const claimed = new Set<number>();
  let created = 0;
  let kept = 0;

  for (const segment of prepared) {
    const points = segment.coordinates.map(([lng, lat]) => [lng, lat] as LngLat);
    const corridor = makeCorridor(points);

    let match: (typeof corridors)[number] | null = null;
    for (const candidate of corridors) {
      if (candidate.activityType !== segment.activityType) continue;
      if (claimed.has(candidate.id)) continue;
      const ratio =
        Math.min(candidate.points.length, points.length) /
        Math.max(candidate.points.length, points.length);
      if (ratio < 0.8) continue;
      const overlap = corridorMatch(corridor, candidate.points);
      if (overlap.fraction >= 0.8 && overlap.forward) {
        match = candidate;
        break;
      }
    }

    const bounds = trackBounds(segment.coordinates as TrackPoint[]);
    const polyline = encodePolyline(segment.coordinates.map(([lng, lat]) => [lat, lng]));
    const row = {
      activityType: segment.activityType,
      distanceM: segment.distanceM,
      elevationGainM: segment.elevationGainM,
      elevationLossM: segment.elevationLossM,
      coordinates: segment.coordinates,
      pointCount: segment.coordinates.length,
      bounds,
      polyline,
      effortCount: segment.efforts.length,
      firstEffortAt: segment.efforts[0].startedAt,
      lastEffortAt: segment.efforts[segment.efforts.length - 1].startedAt,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    let segmentId: number;
    if (match) {
      claimed.add(match.id);
      await db.update(activitySegments).set(row).where(eq(activitySegments.id, match.id));
      segmentId = match.id;
      kept++;
    } else {
      const name = segmentName(segmentSeed(segment.coordinates), takenNames);
      takenNames.add(name);
      const [inserted] = await db
        .insert(activitySegments)
        .values({ ...row, name })
        .returning({ id: activitySegments.id });
      segmentId = inserted.id;
      created++;
    }

    await db
      .delete(activitySegmentEfforts)
      .where(eq(activitySegmentEfforts.segmentId, segmentId));

    const laps = new Map<string, number>();
    await db.insert(activitySegmentEfforts).values(
      segment.efforts.map((effort) => {
        const lapIndex = (laps.get(effort.activityId) ?? 0) + 1;
        laps.set(effort.activityId, lapIndex);
        return {
          segmentId,
          activityId: effort.activityId,
          startS: effort.startS,
          endS: effort.endS,
          durationS: effort.metrics.durationS,
          distanceM: effort.distanceM,
          speedMps: effort.metrics.speedMps,
          paceSPerKm: effort.metrics.paceSPerKm,
          avgHeartrate: effort.metrics.avgHeartrate,
          maxHeartrate: effort.metrics.maxHeartrate,
          elevationGainM: effort.elevationGainM,
          efficiencyFactor: effort.metrics.efficiencyFactor,
          beatsPerKm: effort.metrics.beatsPerKm,
          startedAt: effort.startedAt,
          lapIndex,
        };
      }),
    );
  }

  const orphaned = stored.filter((s) => !claimed.has(s.id)).map((s) => s.id);
  if (orphaned.length) {
    await db.delete(activitySegments).where(inArray(activitySegments.id, orphaned));
  }

  return { created, kept, removed: orphaned.length };
}

// --- background scheduling --------------------------------------------------

let inFlight: Promise<void> | null = null;
let againRequested = false;

/**
 * Ask for a rebuild without waiting for one.
 *
 * Called after an ingest that landed new GPS traces. Two properties matter:
 * the phone is never held waiting on it, and two arrivals close together
 * produce one rebuild followed by one more — not two racing writers over the
 * same tables. A request that arrives mid-rebuild sets the flag and is served
 * by the next lap, because the run already in progress may have read the
 * activity list before the new row landed.
 */
export function scheduleSegmentRebuild(): void {
  if (inFlight) {
    againRequested = true;
    return;
  }

  const run = async () => {
    do {
      againRequested = false;
      try {
        const report = await rebuildSegments();
        console.log(
          `[trails] segments rebuilt: ${report.segments} segments, ${report.efforts} efforts, ` +
            `${report.created} new, ${report.removed} retired, ${(report.elapsedMs / 1000).toFixed(1)}s`,
        );
      } catch (err) {
        console.warn('[trails] segment rebuild failed:', (err as Error)?.message);
      }
    } while (againRequested);
  };

  inFlight = run().finally(() => {
    inFlight = null;
  });
}
