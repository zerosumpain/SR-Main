import { db } from '$lib/db';
import { whoopCycles } from '$lib/db/schema';
import { gte, asc } from 'drizzle-orm';
import { computeACWR, type LoadDay } from '$lib/health/analytics/acwr';
import { realStrain } from '$lib/health/whoop';

export async function getACWR() {
  const since = Math.floor(Date.now() / 1000) - 28 * 86400;
  const rows = await db
    .select({ start: whoopCycles.startDate, strain: whoopCycles.strain })
    .from(whoopCycles)
    .where(gte(whoopCycles.startDate, since))
    .orderBy(asc(whoopCycles.startDate));

  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = new Date(r.start * 1000).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + realStrain(r.strain));
  }
  const days: LoadDay[] = [...byDay.entries()].map(([date, load]) => ({ date, load }));
  return computeACWR(days);
}
