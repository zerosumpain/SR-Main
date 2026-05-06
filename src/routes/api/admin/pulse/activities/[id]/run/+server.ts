import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { heartbeatActivities } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getHandler } from '$lib/heartbeat/registry';
import { recordPulse } from '$lib/heartbeat/audit';

/**
 * Manually trigger an activity now, regardless of next_tick_at. The result
 * is recorded as a pulse, and next_tick_at is reset to now+cadence so the
 * regular schedule continues from this point.
 */
export const POST: RequestHandler = async ({ params }) => {
  const [row] = await db.select().from(heartbeatActivities).where(eq(heartbeatActivities.id, params.id)).limit(1);
  if (!row) throw error(404, 'activity not found');
  const handler = getHandler(row.name);
  if (!handler) throw error(400, `no handler registered for ${row.name}`);

  const startedAt = Date.now();
  let result;
  try {
    result = await handler.run({
      now: startedAt,
      config: (row.config as Record<string, unknown>) ?? {},
      activity: row,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { outcome: 'error' as const, summary: msg.slice(0, 200) };
  }

  const nextTickAt = new Date(Date.now() + row.cadenceSeconds * 1000);
  await recordPulse({
    activityId: row.id,
    activityName: row.name,
    result,
    durationMs: Date.now() - startedAt,
    nextTickAt,
  });

  return json({ ok: true, result });
};
