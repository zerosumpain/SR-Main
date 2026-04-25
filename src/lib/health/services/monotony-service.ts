import { db } from '$lib/db';
import { whoopCycles } from '$lib/db/schema';
import { gte, asc } from 'drizzle-orm';
import { computeMonotony } from '$lib/health/analytics/monotony';

export async function getMonotony() {
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const rows = await db
    .select({ start: whoopCycles.startDate, strain: whoopCycles.strain })
    .from(whoopCycles)
    .where(gte(whoopCycles.startDate, since))
    .orderBy(asc(whoopCycles.startDate));

  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = new Date(r.start * 1000).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + r.strain);
  }
  const today = new Date();
  const series: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push(byDay.get(key) ?? 0);
  }
  return computeMonotony(series);
}
