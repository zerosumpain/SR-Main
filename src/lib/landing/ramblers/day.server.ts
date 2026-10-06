// Today's Apple Health totals, reduced to the rambler's coarse flags.
//
// Same table, scale and local day as the landing's step strip
// (steps-today.server.ts). Units follow the phone's settings, which is one
// more reason only thresholds leave this file.
import { and, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { appleHealthMetrics } from '$lib/db/schema';
import { fromStoredMetric } from '$lib/constants/apple-health-scale';
import { heroDayBounds } from '$lib/server/hero-slot-policy';
import { dayFlags, NO_DAY, type DayFlags, type DayTotals } from './day';

const METRICS: Record<string, keyof DayTotals> = {
  step_count: 'steps',
  apple_exercise_time: 'exerciseMin',
  flights_climbed: 'flights',
  distance_cycling: 'cyclingKm',
  walking_running_distance: 'walkRunKm',
  mindful_minutes: 'mindfulMin',
  time_in_daylight: 'daylightMin',
};

export async function ramblerDay(now = new Date()): Promise<DayFlags> {
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
