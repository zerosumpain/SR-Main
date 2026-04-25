import { db } from '$lib/db';
import { whoopSleep } from '$lib/db/schema';
import { gte, eq, and, asc } from 'drizzle-orm';
import { computeSRI, type SleepInterval } from '$lib/health/analytics/sri';

export async function getSleepRegularity() {
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  const rows = await db
    .select({
      start: whoopSleep.startDate,
      end: whoopSleep.endDate,
      nap: whoopSleep.nap,
    })
    .from(whoopSleep)
    .where(and(gte(whoopSleep.startDate, since), eq(whoopSleep.nap, false)))
    .orderBy(asc(whoopSleep.startDate));

  const intervals: SleepInterval[] = rows.map((r) => ({
    startLocalIso: new Date(r.start * 1000).toISOString(),
    endLocalIso: new Date(r.end * 1000).toISOString(),
  }));
  return computeSRI(intervals);
}
