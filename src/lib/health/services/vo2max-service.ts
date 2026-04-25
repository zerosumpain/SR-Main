import { db } from '$lib/db';
import { appleHealthMetrics } from '$lib/db/schema';
import { gte, eq, and, asc } from 'drizzle-orm';
import { computeVO2MaxResult, type VO2Sample } from '$lib/health/analytics/vo2max-percentile';

const PROFILE = { age: 32, sex: 'male' as const };  // TODO(personal): wire to a profile config when one exists

export async function getVO2Max() {
  const since = Math.floor(Date.now() / 1000) - 90 * 86400;
  const rows = await db
    .select({ date: appleHealthMetrics.date, value: appleHealthMetrics.value })
    .from(appleHealthMetrics)
    .where(and(eq(appleHealthMetrics.metricName, 'vo2_max'), gte(appleHealthMetrics.date, since)))
    .orderBy(asc(appleHealthMetrics.date));

  const series: VO2Sample[] = rows
    .filter((r) => r.value != null)
    .map((r) => ({ date: new Date(r.date * 1000).toISOString().slice(0, 10), value: (r.value as number) / 100 }));

  return computeVO2MaxResult(series, PROFILE);
}
