// Read side for /trails. Mirrors the shape of the other health services:
// server-only, returns plain data, never throws for "no rows".

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { activities, activitySegmentEfforts, activitySeries, activityTracks } from '$lib/db/schema';
import { celsiusFrom, effectiveType, humidityPct } from './activity-meta';
import {
  computeSplits,
  elevationProfile,
  type ElevationSample,
  type Split,
  type TrackPoint,
} from './track';
import { isPaceSport } from './format';
import { efficiencyFactor } from '$lib/health/analytics/efficiency';

export interface ActivityListRow {
  id: string;
  name: string;
  /** The owner's correction where there is one — see effectiveType(). */
  activityType: string;
  /** What the source called it, kept so the correction is visible as a change. */
  sourceType: string;
  typeOverride: string | null;
  startDate: number;
  startDateLocal: string;
  distanceM: number | null;
  durationS: number;
  activeDurationS: number | null;
  elevationGainM: number | null;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  avgPaceSPerKm: number | null;
  activeEnergyKj: number | null;
  hasTrack: boolean;
  polyline: string | null;
  /** Ambient temperature in °C, unit-normalised out of the metadata jsonb. */
  temperatureC: number | null;
  /** metres per minute per bpm — null outside the pace sports and without HR. */
  efficiencyFactor: number | null;
  /** How many known segments this outing crossed. */
  segmentCount: number;
  excludedFromSegments: boolean;
}

export interface ActivityTotals {
  count: number;
  distanceM: number;
  durationS: number;
  elevationGainM: number;
}

export interface ActivityListResult {
  rows: ActivityListRow[];
  totals: ActivityTotals;
  types: Array<{ activityType: string; count: number }>;
}

export interface ActivityDetail extends ActivityListRow {
  source: string;
  rawType: string | null;
  endDate: number;
  timezone: string | null;
  elevationLossM: number | null;
  totalEnergyKj: number | null;
  humidityPct: number | null;
  avgCadence: number | null;
  metadata: Record<string, unknown> | null;
  coordinates: TrackPoint[] | null;
  bounds: { n: number; s: number; e: number; w: number } | null;
  elevation: ElevationSample[];
  splits: Split[];
  series: Array<{ metric: string; units: string; samples: [number, number][] }>;
}

/**
 * The type to read everywhere: the owner's correction, falling back to what the
 * source said. Expressed in SQL so the filter, the group-by and the row
 * projection cannot disagree about it — and with the same trim-and-empty
 * semantics as effectiveType() in activity-meta, or a whitespace-only override
 * would mean one thing in Postgres and another in JavaScript.
 */
export const EFFECTIVE_TYPE = sql<string>`coalesce(nullif(trim(${activities.typeOverride}), ''), ${activities.activityType})`;

/** Types that carry a GPS trace — the default view of the activity list. */
export const OUTDOOR_TYPES = ['run', 'trail_run', 'ride', 'mtb', 'hike', 'walk'];

export async function listActivities(
  opts: {
    types?: string[];
    sinceDays?: number;
    limit?: number;
    /**
     * Encoded track geometry, for callers that draw a thumbnail.
     *
     * Off by default because it is the single heaviest field on the row —
     * roughly a kilobyte per activity, so over a thousand rows it is more than
     * a megabyte of payload for a table that renders no map at all.
     */
    withPolyline?: boolean;
  } = {},
): Promise<ActivityListResult> {
  const { types, sinceDays, limit = 100, withPolyline = false } = opts;

  const filters = [];
  // Filter on the EFFECTIVE type. A ride the watch logged as a walk answers to
  // "ride" everywhere else on the site, and a type chip that disagreed with the
  // row it filtered would be the correction quietly not working.
  if (types?.length) filters.push(inArray(EFFECTIVE_TYPE, types));
  if (sinceDays) {
    filters.push(gte(activities.startDate, Math.floor(Date.now() / 1000) - sinceDays * 86400));
  }
  const where = filters.length ? and(...filters) : undefined;

  const rows = await db
    .select({
      id: activities.id,
      name: activities.name,
      activityType: activities.activityType,
      startDate: activities.startDate,
      startDateLocal: activities.startDateLocal,
      distanceM: activities.distanceM,
      durationS: activities.durationS,
      activeDurationS: activities.activeDurationS,
      elevationGainM: activities.elevationGainM,
      avgHeartrate: activities.avgHeartrate,
      maxHeartrate: activities.maxHeartrate,
      avgPaceSPerKm: activities.avgPaceSPerKm,
      activeEnergyKj: activities.activeEnergyKj,
      hasTrack: activities.hasTrack,
      polyline: withPolyline ? activityTracks.polyline : sql<string | null>`null`,
      typeOverride: activities.typeOverride,
      excludedFromSegments: activities.excludedFromSegments,
      // Three scalars out of the metadata jsonb, projected in SQL. Selecting
      // the column itself would ship the phone's per-minute stepCount,
      // basalEnergy and heartRate arrays — about 11 KB of JSON per row.
      temperature: sql<unknown>`${activities.metadata} -> 'temperature'`,
      humidity: sql<unknown>`${activities.metadata} -> 'humidity'`,
      segmentCount: sql<number>`(
        select count(distinct ${activitySegmentEfforts.segmentId})::int
        from ${activitySegmentEfforts}
        where ${activitySegmentEfforts.activityId} = ${activities.id}
      )`,
    })
    .from(activities)
    .leftJoin(activityTracks, eq(activityTracks.activityId, activities.id))
    .where(where)
    .orderBy(desc(activities.startDate))
    .limit(limit);

  // Totals come from the same filter but not the same page — a "this year"
  // total that silently meant "the 100 rows shown" would be a lie.
  const [totals] = await db
    .select({
      count: sql<number>`count(*)::int`,
      distanceM: sql<number>`coalesce(sum(${activities.distanceM}), 0)`,
      durationS: sql<number>`coalesce(sum(${activities.durationS}), 0)::int`,
      elevationGainM: sql<number>`coalesce(sum(${activities.elevationGainM}), 0)`,
    })
    .from(activities)
    .where(where);

  const types_ = await db
    .select({
      activityType: EFFECTIVE_TYPE,
      count: sql<number>`count(*)::int`,
    })
    .from(activities)
    .groupBy(EFFECTIVE_TYPE)
    .orderBy(desc(sql`count(*)`));

  return {
    rows: rows.map((r) => {
      const type = effectiveType(r);
      return {
        id: r.id,
        name: r.name,
        activityType: type,
        sourceType: r.activityType,
        typeOverride: r.typeOverride,
        startDate: r.startDate,
        startDateLocal: r.startDateLocal,
        distanceM: r.distanceM,
        durationS: r.durationS,
        activeDurationS: r.activeDurationS,
        elevationGainM: r.elevationGainM,
        avgHeartrate: r.avgHeartrate,
        maxHeartrate: r.maxHeartrate,
        avgPaceSPerKm: r.avgPaceSPerKm,
        activeEnergyKj: r.activeEnergyKj,
        hasTrack: r.hasTrack,
        polyline: r.polyline,
        temperatureC: celsiusFrom(r.temperature),
        // EF only where pace is the sport's currency: a ride's sits near 4
        // against a run's 1, and one mixed column would sort into a list of
        // bike rides. Same partition the segments explorer applies.
        efficiencyFactor: isPaceSport(type)
          ? efficiencyFactor(r.distanceM, r.activeDurationS ?? r.durationS, r.avgHeartrate)
          : null,
        segmentCount: r.segmentCount ?? 0,
        excludedFromSegments: r.excludedFromSegments,
      } satisfies ActivityListRow;
    }),
    totals: totals ?? { count: 0, distanceM: 0, durationS: 0, elevationGainM: 0 },
    types: types_,
  };
}

export async function getActivity(id: string): Promise<ActivityDetail | null> {
  const [activity] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
  if (!activity) return null;

  const [track] = await db
    .select()
    .from(activityTracks)
    .where(eq(activityTracks.activityId, id))
    .limit(1);

  const series = await db
    .select()
    .from(activitySeries)
    .where(eq(activitySeries.activityId, id));

  const [segCount] = await db
    .select({ n: sql<number>`count(distinct ${activitySegmentEfforts.segmentId})::int` })
    .from(activitySegmentEfforts)
    .where(eq(activitySegmentEfforts.activityId, id));

  const coordinates = (track?.coordinates as TrackPoint[] | undefined) ?? null;

  return {
    id: activity.id,
    source: activity.source,
    name: activity.name,
    activityType: effectiveType(activity),
    sourceType: activity.activityType,
    typeOverride: activity.typeOverride,
    rawType: activity.rawType,
    startDate: activity.startDate,
    endDate: activity.endDate,
    startDateLocal: activity.startDateLocal,
    timezone: activity.timezone,
    distanceM: activity.distanceM,
    durationS: activity.durationS,
    activeDurationS: activity.activeDurationS,
    elevationGainM: activity.elevationGainM,
    elevationLossM: activity.elevationLossM,
    avgHeartrate: activity.avgHeartrate,
    maxHeartrate: activity.maxHeartrate,
    activeEnergyKj: activity.activeEnergyKj,
    totalEnergyKj: activity.totalEnergyKj,
    avgPaceSPerKm: activity.avgPaceSPerKm,
    avgCadence: activity.avgCadence,
    hasTrack: activity.hasTrack,
    metadata: activity.metadata as Record<string, unknown> | null,
    temperatureC: celsiusFrom((activity.metadata as Record<string, unknown> | null)?.temperature),
    humidityPct: humidityPct(activity.metadata as Record<string, unknown> | null),
    efficiencyFactor: isPaceSport(effectiveType(activity))
      ? efficiencyFactor(
          activity.distanceM,
          activity.activeDurationS ?? activity.durationS,
          activity.avgHeartrate,
        )
      : null,
    segmentCount: segCount?.n ?? 0,
    excludedFromSegments: activity.excludedFromSegments,
    polyline: track?.polyline ?? null,
    coordinates,
    bounds: (track?.bounds as ActivityDetail['bounds']) ?? null,
    elevation: coordinates ? elevationProfile(coordinates) : [],
    splits: coordinates ? computeSplits(coordinates) : [],
    series: series.map((s) => ({
      metric: s.metric,
      units: s.units,
      samples: s.samples as [number, number][],
    })),
  };
}
