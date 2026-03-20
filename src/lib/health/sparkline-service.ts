import { db } from '$lib/db';
import { whoopRecovery, whoopSleep, whoopCycles, appleHealthMetrics } from '$lib/db/schema';
import { desc, gte, eq } from 'drizzle-orm';
import type { SparklineData } from './types';

export async function getSparklines(): Promise<SparklineData[]> {
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;

  // Parallel queries for 4 metrics
  const [recoveries, sleeps, heartRates, cycles] = await Promise.all([
    db.select({ date: whoopRecovery.createdDate, value: whoopRecovery.recoveryScore })
      .from(whoopRecovery).where(gte(whoopRecovery.createdDate, sevenDaysAgo))
      .orderBy(whoopRecovery.createdDate),
    db.select({ date: whoopSleep.startDate, value: whoopSleep.sleepPerformance })
      .from(whoopSleep).where(gte(whoopSleep.startDate, sevenDaysAgo))
      .orderBy(whoopSleep.startDate),
    db.select({ date: appleHealthMetrics.date, value: appleHealthMetrics.value })
      .from(appleHealthMetrics)
      .where(gte(appleHealthMetrics.date, sevenDaysAgo))
      .where(eq(appleHealthMetrics.metricName, 'heart_rate'))
      .orderBy(appleHealthMetrics.date),
    db.select({ date: whoopCycles.startDate, value: whoopCycles.strain })
      .from(whoopCycles).where(gte(whoopCycles.startDate, sevenDaysAgo))
      .orderBy(whoopCycles.startDate),
  ]);

  function toSparkline(metric: string, data: Array<{ date: number | null; value: number | null }>, divideBy = 1): SparklineData {
    const values = data
      .filter(d => d.date != null && d.value != null)
      .map(d => ({
        date: new Date((d.date!) * 1000).toISOString().slice(0, 10),
        value: (d.value!) / divideBy,
      }));
    const current = values.length ? values[values.length - 1].value : 0;
    const prev = values.length > 1 ? values[values.length - 2].value : current;
    const trend = current > prev * 1.05 ? 'up' : current < prev * 0.95 ? 'down' : 'stable';
    return { metric, values, current, trend };
  }

  return [
    toSparkline('recovery', recoveries),
    toSparkline('sleep', sleeps),
    toSparkline('heart_rate', heartRates, 100), // stored * 100
    toSparkline('strain', cycles),
  ];
}
