// Today's Apple Health totals, reduced to the rambler's coarse flags, plus
// last night's sleep and today's recovery from WHOOP as three-step bands.
//
// Same table, scale and local day as the landing's step strip
// (steps-today.server.ts). Units follow the phone's settings, which is one
// more reason only thresholds leave this file.
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { appleHealthMetrics, whoopRecovery, whoopSleep } from '$lib/db/schema';
import { fromStoredMetric } from '$lib/constants/apple-health-scale';
import { heroDayBounds } from '$lib/server/hero-slot-policy';
import { dayFlags, movingBand, NO_DAY, recoveryBand, sleepBand, type DayFlags, type DayTotals } from './day';

const METRICS: Record<string, keyof DayTotals> = {
  step_count: 'steps',
  apple_exercise_time: 'exerciseMin',
  flights_climbed: 'flights',
  distance_cycling: 'cyclingKm',
  walking_running_distance: 'walkRunKm',
  mindful_minutes: 'mindfulMin',
  time_in_daylight: 'daylightMin',
};

async function appleFlags(now: Date): Promise<DayFlags> {
  const bounds = heroDayBounds(now);
  const nowSec = Math.floor(now.getTime() / 1000);
  try {
    const rows = await db
      .select({ name: appleHealthMetrics.metricName, total: sql<number>`coalesce(sum(${appleHealthMetrics.value}), 0)` })
      .from(appleHealthMetrics)
      .where(
        and(
          inArray(appleHealthMetrics.metricName, Object.keys(METRICS)),
          gte(appleHealthMetrics.date, bounds.start),
          lt(appleHealthMetrics.date, Math.min(bounds.end, nowSec + 1)),
        ),
      )
      .groupBy(appleHealthMetrics.metricName);
    const totals: DayTotals = { steps: 0, exerciseMin: 0, flights: 0, cyclingKm: 0, walkRunKm: 0, mindfulMin: 0, daylightMin: 0 };
    for (const r of rows) totals[METRICS[r.name]] = fromStoredMetric(Number(r.total));
    return dayFlags(totals);
  } catch {
    return NO_DAY;
  }
}

/** Last night: the latest main sleep that ended in the past eighteen hours. Durations are milliseconds. */
async function lastNight(nowSec: number) {
  try {
    const [row] = await db
      .select({ inBed: whoopSleep.totalInBed, awake: whoopSleep.totalAwake })
      .from(whoopSleep)
      .where(and(eq(whoopSleep.nap, false), gte(whoopSleep.endDate, nowSec - 18 * 3600)))
      .orderBy(desc(whoopSleep.endDate))
      .limit(1);
    return row ? sleepBand(Math.max(0, row.inBed - row.awake) / 3_600_000) : null;
  } catch {
    return null;
  }
}

async function todaysRecovery(nowSec: number) {
  try {
    const [row] = await db
      .select({ score: whoopRecovery.recoveryScore })
      .from(whoopRecovery)
      .where(gte(whoopRecovery.createdDate, nowSec - 24 * 3600))
      .orderBy(desc(whoopRecovery.createdDate))
      .limit(1);
    return row ? recoveryBand(row.score) : null;
  } catch {
    return null;
  }
}

/**
 * How much jk has moved lately: steps in the last 45 minutes, if the phone has
 * sent any samples in the last half hour. Only the band leaves this file.
 */
async function lately(nowSec: number) {
  try {
    const rows = await db
      .select({ date: appleHealthMetrics.date, value: appleHealthMetrics.value })
      .from(appleHealthMetrics)
      .where(and(eq(appleHealthMetrics.metricName, 'step_count'), gte(appleHealthMetrics.date, nowSec - 90 * 60)));
    const fresh = rows.some((r) => r.date >= nowSec - 30 * 60);
    const steps = rows.filter((r) => r.date >= nowSec - 45 * 60).reduce((s, r) => s + (typeof r.value === 'number' ? fromStoredMetric(r.value) : 0), 0);
    return movingBand(steps, fresh);
  } catch {
    return null;
  }
}

export async function ramblerDay(now = new Date()): Promise<DayFlags> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const [flags, sleep, recovery, moving] = await Promise.all([appleFlags(now), lastNight(nowSec), todaysRecovery(nowSec), lately(nowSec)]);
  return { ...flags, sleep, recovery, moving };
}
