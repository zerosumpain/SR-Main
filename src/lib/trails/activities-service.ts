// Read side for /trails. Mirrors the shape of the other health services:
// server-only, returns plain data, never throws for "no rows".

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { activities, activitySeries, activityTracks } from '$lib/db/schema';
import {
  computeSplits,
  elevationProfile,
  type ElevationSample,
  type Split,
  type TrackPoint,
} from './track';

export interface ActivityListRow {
  id: string;
  name: string;
  activityType: string;
  startDate: number;
  startDateLocal: string;
  distanceM: number | null;
  durationS: number;
  activeDurationS: number | null;
  elevationGainM: number | null;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  avgPaceSPerKm: number | null;
  hasTrack: boolean;
  polyline: string | null;
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
  activeEnergyKj: number | null;
  totalEnergyKj: number | null;
  avgCadence: number | null;
  metadata: Record<string, unknown> | null;
  coordinates: TrackPoint[] | null;
  bounds: { n: number; s: number; e: number; w: number } | null;
  elevation: ElevationSample[];
  splits: Split[];
  series: Array<{ metric: string; units: string; samples: [number, number][] }>;
}

/** Types that carry a GPS trace — the default view of /trails. */
export const OUTDOOR_TYPES = ['run', 'trail_run', 'ride', 'mtb', 'hike', 'walk'];

export async function listActivities(
  opts: { types?: string[]; sinceDays?: number; limit?: number } = {},
): Promise<ActivityListResult> {
  const { types, sinceDays, limit = 100 } = opts;

  const filters = [];
  if (types?.length) filters.push(inArray(activities.activityType, types));
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
      hasTrack: activities.hasTrack,
      polyline: activityTracks.polyline,
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
      activityType: activities.activityType,
      count: sql<number>`count(*)::int`,
    })
    .from(activities)
    .groupBy(activities.activityType)
    .orderBy(desc(sql`count(*)`));

  return {
    rows,
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

  const coordinates = (track?.coordinates as TrackPoint[] | undefined) ?? null;

  return {
    id: activity.id,
    source: activity.source,
    name: activity.name,
    activityType: activity.activityType,
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
