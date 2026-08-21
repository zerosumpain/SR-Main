// The week's volume and the all-time bests, for /health's "long game" chapter.
//
// These read the `activities` table — the normalised one every other surface on
// the site reads (the activity list, the outings list, the segment efforts).
// They used to read `strava_activities`, which has been EMPTY since the Strava
// application went dormant, so the card printed "0 sessions, 0.0km logged over
// 0m of moving time" beside a chapter listing five outings and 34 km, and the
// records card had nothing to render at all.
//
// Recovery and sleep still come from Whoop, which is still syncing.
import { db } from '$lib/db';
import { activities, whoopRecovery, whoopSleep } from '$lib/db/schema';
import { and, gte, isNotNull, sql, type SQL } from 'drizzle-orm';
import { EFFECTIVE_TYPE } from '$lib/trails/activities-service';
import { localDay } from '$lib/trails/activity-meta';
import { formatPace } from '$lib/trails/format';
import type { StatsResponse } from './types';

/** Moving time where the recording has one, elapsed time where it does not. */
const MOVING_S = sql<number>`coalesce(${activities.activeDurationS}, ${activities.durationS}, 0)`;

/** Seconds per kilometre. The stored figure where ingest computed one. */
const PACE_S_PER_KM = sql<number>`coalesce(
  ${activities.avgPaceSPerKm},
  ${MOVING_S} / nullif(${activities.distanceM}, 0) * 1000
)`;

/** Both run flavours — a trail run is still the longest run you have done. */
const RUNS = sql`${EFFECTIVE_TYPE} in ('run', 'trail_run')`;

/** The local calendar day, never the UTC one — a 23:40 outing is not tomorrow. */
function recordDay(row: { startDateLocal: string; startDate: number }): string {
  return localDay(row.startDateLocal) ?? new Date(row.startDate * 1000).toISOString().slice(0, 10);
}

/** The single best row on `order`, or null when nothing qualifies. */
async function best(where: SQL | undefined, order: SQL) {
  const [row] = await db
    .select({
      startDate: activities.startDate,
      startDateLocal: activities.startDateLocal,
      distanceM: activities.distanceM,
      elevationGainM: activities.elevationGainM,
      paceSPerKm: PACE_S_PER_KM,
    })
    .from(activities)
    .where(where)
    .orderBy(order)
    .limit(1);
  return row ?? null;
}

export async function getStats(): Promise<StatsResponse> {
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;

  const [[week], recoveries, sleeps, longestRun, fastestRun, mostElevation] = await Promise.all([
    // Aggregated in Postgres, not by pulling the week into memory and reducing
    // it — this is the same shape as listActivities' totals.
    db
      .select({
        activities: sql<number>`count(*)::int`,
        totalDistance: sql<number>`coalesce(sum(${activities.distanceM}), 0)`,
        totalDuration: sql<number>`coalesce(sum(${MOVING_S}), 0)::int`,
        totalElevation: sql<number>`coalesce(sum(${activities.elevationGainM}), 0)`,
      })
      .from(activities)
      .where(gte(activities.startDate, sevenDaysAgo)),
    db.select().from(whoopRecovery).where(gte(whoopRecovery.createdDate, sevenDaysAgo)),
    db.select().from(whoopSleep).where(gte(whoopSleep.startDate, sevenDaysAgo)),

    best(RUNS, sql`${activities.distanceM} desc nulls last`),
    // 5 km is the floor because a 400 m sprint is not a pace record.
    best(
      and(RUNS, gte(activities.distanceM, 5000), isNotNull(activities.distanceM)),
      sql`${PACE_S_PER_KM} asc nulls last`,
    ),
    best(undefined, sql`${activities.elevationGainM} desc nulls last`),
  ]);

  const weekly = {
    activities: week?.activities ?? 0,
    totalDistance: week?.totalDistance ?? 0,
    totalDuration: week?.totalDuration ?? 0,
    totalElevation: week?.totalElevation ?? 0,
    avgRecovery: recoveries.length
      ? Math.round(recoveries.reduce((sum, r) => sum + (r.recoveryScore || 0), 0) / recoveries.length)
      : 0,
    avgSleep: sleeps.length
      ? Math.round(sleeps.reduce((sum, s) => sum + (s.sleepPerformance || 0), 0) / sleeps.length)
      : 0,
  };

  const personalRecords: StatsResponse['personalRecords'] = [];

  if (longestRun?.distanceM) {
    personalRecords.push({
      label: 'Longest Run',
      value: Math.round((longestRun.distanceM / 1000) * 10) / 10,
      unit: 'km',
      date: recordDay(longestRun),
    });
  }

  if (fastestRun?.paceSPerKm) {
    personalRecords.push({
      label: 'Fastest Pace',
      value: Math.round((fastestRun.paceSPerKm / 60) * 100) / 100,
      unit: 'min/km',
      display: formatPace(fastestRun.paceSPerKm),
      date: recordDay(fastestRun),
    });
  }

  if (mostElevation?.elevationGainM) {
    personalRecords.push({
      label: 'Most Elevation',
      value: Math.round(mostElevation.elevationGainM),
      unit: 'm',
      date: recordDay(mostElevation),
    });
  }

  return { weekly, personalRecords };
}
