import { db } from '$lib/db';
import { intelAlerts } from '$lib/db/schema';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { DailyAlertsSummary } from './daily-alerts';

/** Shared rolling daily window; delivery does not dismiss an alert. */
export async function loadDailyAlerts(now = new Date()): Promise<DailyAlertsSummary> {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const base = { since: since.toISOString(), asOf: now.toISOString(), total: 0, high: 0, items: [] };
  try {
    const rows = await db.select({
      id: intelAlerts.id, title: intelAlerts.title, content: intelAlerts.content,
      significance: intelAlerts.significance, createdAt: intelAlerts.createdAt,
      total: sql<number>`count(*) over ()`.mapWith(Number),
      high: sql<number>`count(*) filter (where ${intelAlerts.significance} = 'high') over ()`.mapWith(Number),
    }).from(intelAlerts).where(and(
      eq(intelAlerts.dismissed, false), gte(intelAlerts.createdAt, since), lte(intelAlerts.createdAt, now),
    )).orderBy(
      sql`case ${intelAlerts.significance} when 'high' then 0 when 'medium' then 1 else 2 end`,
      desc(intelAlerts.createdAt), intelAlerts.id,
    ).limit(6);
    return {
      ...base, status: rows.length ? 'ok' : 'empty', total: rows[0]?.total ?? 0, high: rows[0]?.high ?? 0,
      items: rows.map(({ total, high, ...row }) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    };
  } catch (err) {
    console.error('[intel] daily alerts unavailable:', err);
    return { ...base, status: 'failed' };
  }
}
