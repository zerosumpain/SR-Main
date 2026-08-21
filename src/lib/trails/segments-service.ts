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
import { isOffroadType, isPaceSport } from './format';
import { resampleTrack } from './segments/resample';
import { discoverSegments, type DiscoveredSegment, type MatchOptions } from './segments/matcher';
import { makeCorridor, corridorMatch, type LngLat } from './segments/corridor';
import { effortMetrics, rankEfforts } from './segments/metrics';
import { segmentForm, UNKNOWN_FORM, type FormEffort, type SegmentForm } from './segments/form';
import { celsiusFrom } from './activity-meta';
import {
  segmentDescriptor,
  segmentName,
  segmentSeed,
  segmentTerrain,
  type SegmentTerrain,
} from './segments/naming';
import {
  netGradientPct,
  similarByClimb,
  similarByEfficiency,
  type Scored,
} from './segments/similarity';

export type SegmentGeometry = Array<[number, number, number | null, number]>;

/** Best-of readouts per segment, aggregated over its efforts. */
export interface SegmentBests {
  durationS: number | null;
  paceSPerKm: number | null;
  efficiencyFactor: number | null;
  beatsPerKm: number | null;
}

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
  terrain: SegmentTerrain;
  /** Net rise over run in percent; a descent reads negative. */
  gradientPct: number;
  offroad: boolean;
  bests: SegmentBests;
  /**
   * Which way this ground is going — the recent window's median time against
   * the window before it, plus the gap from the recent best to the all-time PB.
   * A leaderboard says what your best ever was; this says whether you are still
   * getting there.
   */
  form: SegmentForm;
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
  /**
   * Ambient temperature the watch recorded for the PARENT ACTIVITY, in °C.
   * Not the effort's own — a workout carries one reading — but on a 500 m to
   * 5 km stretch inside one outing that is the same weather.
   */
  temperatureC: number | null;
}

export interface SegmentDetail extends SegmentListRow {
  coordinates: SegmentGeometry;
  bounds: { n: number; s: number; e: number; w: number } | null;
  efforts: SegmentEffortRow[];
  /**
   * What the weather was doing. Segments carry no weather of their own — there
   * is no weather table in this schema and open-meteo is fetched live, keyed to
   * now, so it cannot answer "what was it like on that run". The ONE honest
   * source is the ambient temperature the watch recorded on the parent activity,
   * unit-normalised out of its metadata jsonb.
   */
  conditions: SegmentConditions;
}

export interface SegmentConditions {
  /** Mean °C across the efforts that carried a reading. */
  meanC: number | null;
  /** Mean °C of the three quickest efforts, and of the three slowest. */
  quickestC: number | null;
  slowestC: number | null;
  /** How many efforts had a temperature at all. */
  sample: number;
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
  /**
   * How many efforts each rank was measured against. HR-derived metrics go null
   * far more often than they look — `effortMetrics` discards a heart-rate window
   * that covers less than half the effort — so "3rd by efficiency" is out of the
   * EF-RANKED efforts, not out of `effortCount`. Printing the wrong denominator
   * is how a 3rd of 4 becomes a 3rd of 19.
   */
  rankedByTimeOf: number;
  rankedByEfficiencyOf: number;
}

type SegmentListSource = Omit<
  typeof activitySegments.$inferSelect,
  'coordinates' | 'bounds' | 'pointCount' | 'updatedAt'
>;

const EMPTY_BESTS: SegmentBests = {
  durationS: null,
  paceSPerKm: null,
  efficiencyFactor: null,
  beatsPerKm: null,
};

function toListRow(
  row: SegmentListSource,
  bests: SegmentBests = EMPTY_BESTS,
  form: SegmentForm = UNKNOWN_FORM,
): SegmentListRow {
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
    terrain: segmentTerrain(row),
    gradientPct: Math.round(netGradientPct(row) * 10) / 10,
    offroad: isOffroadType(row.activityType),
    bests,
    form,
  };
}

/** min/max the aggregate query does, for callers that already hold the efforts. */
export function bestsFromEfforts(
  efforts: Array<Pick<SegmentEffortRow, 'durationS' | 'paceSPerKm' | 'efficiencyFactor' | 'beatsPerKm'>>,
): SegmentBests {
  const best = (
    values: Array<number | null>,
    pick: (a: number, b: number) => number,
  ): number | null => {
    const present = values.filter((v): v is number => v != null && Number.isFinite(v));
    return present.length ? present.reduce((a, b) => pick(a, b)) : null;
  };
  return {
    durationS: best(efforts.map((e) => e.durationS), Math.min),
    paceSPerKm: best(efforts.map((e) => e.paceSPerKm), Math.min),
    efficiencyFactor: best(efforts.map((e) => e.efficiencyFactor), Math.max),
    beatsPerKm: best(efforts.map((e) => e.beatsPerKm), Math.min),
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
  //
  // The bests come from one grouped pass over the efforts — the explorer sorts
  // and crowns records from these without touching the per-effort table again.
  const [rows, typeCounts, bestRows, formRows] = await Promise.all([
    db
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
      .limit(limit),
    db
      .select({
        activityType: activitySegments.activityType,
        count: sql<number>`count(*)::int`,
      })
      .from(activitySegments)
      .groupBy(activitySegments.activityType)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        segmentId: activitySegmentEfforts.segmentId,
        durationS: sql<number | null>`min(${activitySegmentEfforts.durationS})`,
        paceSPerKm: sql<number | null>`min(${activitySegmentEfforts.paceSPerKm})`,
        efficiencyFactor: sql<number | null>`max(${activitySegmentEfforts.efficiencyFactor})`,
        beatsPerKm: sql<number | null>`min(${activitySegmentEfforts.beatsPerKm})`,
      })
      .from(activitySegmentEfforts)
      .groupBy(activitySegmentEfforts.segmentId),
    // Three columns per effort, for the Form window. There are no window
    // functions anywhere in this subsystem — every rank and trend in it is
    // computed in JavaScript over rows already in memory — and at ~6,300 efforts
    // this is a far smaller read than the geometry the projection above avoids.
    db
      .select({
        segmentId: activitySegmentEfforts.segmentId,
        durationS: activitySegmentEfforts.durationS,
        startedAt: activitySegmentEfforts.startedAt,
        efficiencyFactor: activitySegmentEfforts.efficiencyFactor,
      })
      .from(activitySegmentEfforts)
      .orderBy(asc(activitySegmentEfforts.startedAt)),
  ]);
  const bestsById = new Map<number, SegmentBests>(
    bestRows.map(({ segmentId, ...bests }) => [segmentId, bests]),
  );

  const effortsById = new Map<number, FormEffort[]>();
  for (const e of formRows) {
    const bucket = effortsById.get(e.segmentId);
    if (bucket) bucket.push(e);
    else effortsById.set(e.segmentId, [e]);
  }

  return {
    rows: rows.map((row) =>
      toListRow(
        row,
        bestsById.get(row.id) ?? EMPTY_BESTS,
        segmentForm(effortsById.get(row.id) ?? []),
      ),
    ),
    types: typeCounts,
  };
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
      // One key out of the metadata jsonb. Selecting the column itself would
      // drag the phone's per-minute stepCount and heartRate arrays — roughly
      // 11 KB of JSON per row — into a leaderboard.
      temperature: sql<unknown>`${activities.metadata} -> 'temperature'`,
    })
    .from(activitySegmentEfforts)
    .innerJoin(activities, eq(activities.id, activitySegmentEfforts.activityId))
    .where(inArray(activitySegmentEfforts.segmentId, segmentIds))
    .orderBy(desc(activitySegmentEfforts.startedAt));

  for (const row of rows) {
    const { segmentId, temperature, ...effort } = row;
    const bucket = out.get(segmentId);
    const withTemp: SegmentEffortRow = { ...effort, temperatureC: celsiusFrom(temperature) };
    if (bucket) bucket.push(withTemp);
    else out.set(segmentId, [withTemp]);
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
    ...toListRow(segment, bestsFromEfforts(efforts), segmentForm(efforts)),
    coordinates: (segment.coordinates as SegmentGeometry) ?? [],
    bounds: (segment.bounds as SegmentDetail['bounds']) ?? null,
    efforts,
    conditions: conditionsFrom(efforts),
  };
}

/**
 * Temperature against pace on one piece of ground.
 *
 * Three efforts a side, not one: a single quickest effort on a cold day says
 * nothing, and the point of the panel is whether the ground is reliably harder
 * when it is warm. Efforts with no reading are left out of both sides rather
 * than counted as mild.
 */
function conditionsFrom(efforts: SegmentEffortRow[]): SegmentConditions {
  const withTemp = efforts.filter((e) => e.temperatureC != null);
  if (!withTemp.length) return { meanC: null, quickestC: null, slowestC: null, sample: 0 };

  const mean = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

  const byTime = [...withTemp].sort((a, b) => a.durationS - b.durationS);
  const side = Math.min(3, Math.floor(byTime.length / 2)) || 1;

  return {
    meanC: mean(withTemp.map((e) => e.temperatureC as number)),
    quickestC: mean(byTime.slice(0, side).map((e) => e.temperatureC as number)),
    slowestC: mean(byTime.slice(-side).map((e) => e.temperatureC as number)),
    sample: withTemp.length,
  };
}

// --- cross-segment comparisons ------------------------------------------------

export interface SimilarSegments {
  /** Ground that looks the same: nearest in gradient and length, same sport. */
  byClimb: Array<Scored<SegmentListRow>>;
  /** Ground that costs the same: nearest best efficiency factor, same sport. */
  byEfficiency: Array<Scored<SegmentListRow>>;
}

/**
 * The comparison panels for one segment's page. Candidates are every other
 * segment of the same sport — the whole list is a couple of hundred rows, so
 * scoring happens here rather than in SQL.
 */
export async function getSimilarSegments(segment: SegmentDetail): Promise<SimilarSegments> {
  const { rows } = await listSegments({ types: [segment.activityType] });
  const candidates = rows.map((row) => ({
    ...row,
    bestEfficiencyFactor: row.bests.efficiencyFactor,
  }));
  const ref = {
    id: segment.id,
    distanceM: segment.distanceM,
    elevationGainM: segment.elevationGainM,
    elevationLossM: segment.elevationLossM,
    bestEfficiencyFactor: segment.bests.efficiencyFactor,
  };
  return {
    byClimb: similarByClimb(ref, candidates),
    byEfficiency: similarByEfficiency(ref, candidates),
  };
}

// --- dashboard highlights -----------------------------------------------------

export interface SegmentRecord {
  segmentId: number;
  name: string;
  activityType: string;
  value: number;
  startedAt: number | null;
}

export interface SegmentPr {
  segmentId: number;
  name: string;
  activityType: string;
  metric: 'time' | 'efficiency';
  value: number;
  startedAt: number;
  /** The activity's own local clock — the day the PR was lived, not UTC's. */
  startDateLocal: string;
  effortCount: number;
}

export interface SegmentHighlights {
  totals: { segments: number; efforts: number };
  records: {
    fastestPace: SegmentRecord | null; // pace sports only — s/km
    bestEfficiency: SegmentRecord | null;
    lowestCost: SegmentRecord | null; // beats per km
    biggestClimb: SegmentRecord | null; // metres of gain
  };
  /** All-time bests set in the last 30 days, on ground visited ≥3 times. */
  recentPrs: SegmentPr[];
}

const PR_WINDOW_S = 30 * 86400;
const PR_MIN_EFFORTS = 3;

export async function getSegmentHighlights(): Promise<SegmentHighlights> {
  const [segments, efforts] = await Promise.all([
    db
      .select({
        id: activitySegments.id,
        name: activitySegments.name,
        activityType: activitySegments.activityType,
        elevationGainM: activitySegments.elevationGainM,
        effortCount: activitySegments.effortCount,
      })
      .from(activitySegments),
    db
      .select({
        segmentId: activitySegmentEfforts.segmentId,
        durationS: activitySegmentEfforts.durationS,
        paceSPerKm: activitySegmentEfforts.paceSPerKm,
        efficiencyFactor: activitySegmentEfforts.efficiencyFactor,
        beatsPerKm: activitySegmentEfforts.beatsPerKm,
        startedAt: activitySegmentEfforts.startedAt,
        startDateLocal: activities.startDateLocal,
      })
      .from(activitySegmentEfforts)
      .innerJoin(activities, eq(activities.id, activitySegmentEfforts.activityId)),
  ]);
  const byId = new Map(segments.map((s) => [s.id, s]));

  type EffortLite = (typeof efforts)[number];
  const record = (
    pool: EffortLite[],
    read: (e: EffortLite) => number | null,
    pick: 'min' | 'max',
  ): SegmentRecord | null => {
    let best: EffortLite | null = null;
    let bestValue = 0;
    for (const effort of pool) {
      const value = read(effort);
      if (value == null || !Number.isFinite(value)) continue;
      if (!best || (pick === 'min' ? value < bestValue : value > bestValue)) {
        best = effort;
        bestValue = value;
      }
    }
    const segment = best ? byId.get(best.segmentId) : null;
    if (!best || !segment) return null;
    return {
      segmentId: segment.id,
      name: segment.name,
      activityType: segment.activityType,
      value: bestValue,
      startedAt: best.startedAt,
    };
  };

  const paceEfforts = efforts.filter((e) => {
    const segment = byId.get(e.segmentId);
    return segment ? isPaceSport(segment.activityType) : false;
  });

  // Positive gain only: an all-flat corpus must omit the record, not crown an
  // arbitrary segment with "+0 m".
  const biggest = segments.reduce<(typeof segments)[number] | null>(
    (top, s) =>
      s.elevationGainM > 0 && (top == null || s.elevationGainM > top.elevationGainM) ? s : top,
    null,
  );

  // A PR is the all-time best on its segment, set recently, on ground with
  // enough history that beating it means something.
  const cutoff = Math.floor(Date.now() / 1000) - PR_WINDOW_S;
  const bySegment = new Map<number, EffortLite[]>();
  for (const effort of efforts) {
    (bySegment.get(effort.segmentId) ?? bySegment.set(effort.segmentId, []).get(effort.segmentId)!).push(
      effort,
    );
  }

  const recentPrs: SegmentPr[] = [];
  for (const [segmentId, pool] of bySegment) {
    const segment = byId.get(segmentId);
    if (!segment || segment.effortCount < PR_MIN_EFFORTS) continue;

    const fastest = pool.reduce((a, b) => (b.durationS < a.durationS ? b : a));
    if (fastest.startedAt >= cutoff) {
      recentPrs.push({
        segmentId,
        name: segment.name,
        activityType: segment.activityType,
        metric: 'time',
        value: fastest.durationS,
        startedAt: fastest.startedAt,
        startDateLocal: fastest.startDateLocal,
        effortCount: segment.effortCount,
      });
    }

    const withEf = pool.filter((e) => e.efficiencyFactor != null);
    if (withEf.length >= PR_MIN_EFFORTS) {
      const mostEfficient = withEf.reduce((a, b) =>
        (b.efficiencyFactor ?? 0) > (a.efficiencyFactor ?? 0) ? b : a,
      );
      if (mostEfficient.startedAt >= cutoff) {
        recentPrs.push({
          segmentId,
          name: segment.name,
          activityType: segment.activityType,
          metric: 'efficiency',
          value: mostEfficient.efficiencyFactor as number,
          startedAt: mostEfficient.startedAt,
          startDateLocal: mostEfficient.startDateLocal,
          effortCount: segment.effortCount,
        });
      }
    }
  }
  recentPrs.sort((a, b) => b.startedAt - a.startedAt);

  return {
    totals: { segments: segments.length, efforts: efforts.length },
    records: {
      fastestPace: record(paceEfforts, (e) => e.paceSPerKm, 'min'),
      // EF and cost are only comparable within pace sports — a ride's EF sits
      // around 4 and would own both records forever (the dashboard's own D5).
      bestEfficiency: record(paceEfforts, (e) => e.efficiencyFactor, 'max'),
      lowestCost: record(paceEfforts, (e) => e.beatsPerKm, 'min'),
      biggestClimb: biggest
        ? {
            segmentId: biggest.id,
            name: biggest.name,
            activityType: biggest.activityType,
            value: biggest.elevationGainM,
            startedAt: null,
          }
        : null,
    },
    recentPrs: recentPrs.slice(0, 6),
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

    // Competition ranking, shared with the leaderboard and the highlights
    // engine: ties share a rank and the next distinct value skips. This used to
    // be a findIndex over a sorted copy, which silently broke ties by sort order
    // and printed "2nd of 11" where the leaderboard printed "1st of 11" for the
    // same effort.
    const timeRanks = rankEfforts(efforts, 'durationS', (e) => e.durationS);
    const efRanks = rankEfforts(efforts, 'efficiencyFactor', (e) => e.efficiencyFactor);

    for (const effort of ours) {
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
        rankByTime: timeRanks.get(effort) ?? null,
        rankByEfficiency: efRanks.get(effort) ?? null,
        rankedByTimeOf: timeRanks.size,
        rankedByEfficiencyOf: efRanks.size,
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

  // Two owner controls decide what is even eligible here, and both have to be
  // honoured at THIS query or the feature ships visibly broken:
  //
  //  * excludedFromSegments — a drive logged as a ride, a lost fix. Excluding it
  //    has to remove its efforts, not just hide the row, because a bad recording
  //    left in the corpus keeps pushing real efforts down the leaderboard.
  //  * typeOverride — discoverSegments PARTITIONS by activity type and
  //    persistSegments reconciles on `candidate.activityType !== segment.activityType`.
  //    Correcting a walk to a ride re-partitions the whole corpus; reading the
  //    raw column here would leave the correction visible in the table and
  //    nowhere else.
  const tracked = await db
    .select({
      id: activities.id,
      activityType: sql<string>`coalesce(nullif(trim(${activities.typeOverride}), ''), ${activities.activityType})`,
      startDate: activities.startDate,
      coordinates: activityTracks.coordinates,
    })
    .from(activities)
    .innerJoin(activityTracks, eq(activityTracks.activityId, activities.id))
    .where(eq(activities.excludedFromSegments, false))
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
