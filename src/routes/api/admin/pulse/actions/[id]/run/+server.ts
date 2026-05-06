import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { heartbeatActions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getHandler } from '$lib/heartbeat/registry';
import { recordPulse } from '$lib/heartbeat/audit';
import { runTargetedAction } from '$lib/heartbeat/handlers/targeted';
import type { ActivityResult } from '$lib/heartbeat/types';

/**
 * Manually trigger one tick of an action regardless of next_run_at. The
 * pulse is recorded and next_run_at is reset to now+cadence.
 */
export const POST: RequestHandler = async ({ params }) => {
  const [row] = await db.select().from(heartbeatActions).where(eq(heartbeatActions.id, params.id)).limit(1);
  if (!row) throw error(404, 'action not found');

  const startedAt = Date.now();
  let result: ActivityResult;
  try {
    if (row.kind === 'system-scan') {
      const handler = getHandler(row.name);
      if (!handler) throw new Error(`no handler registered for ${row.name}`);
      result = await handler.run({
        now: startedAt,
        config: (row.config as Record<string, unknown>) ?? {},
        action: row,
      });
    } else if (row.kind === 'targeted') {
      result = await runTargetedAction(row);
    } else {
      result = { outcome: 'skipped', summary: `unknown kind ${row.kind}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { outcome: 'error', summary: msg.slice(0, 200) };
  }

  const nextRunAt = new Date(Date.now() + row.cadenceSeconds * 1000);
  await recordPulse({
    actionId: row.id,
    actionName: row.name,
    result,
    durationMs: Date.now() - startedAt,
    nextRunAt,
  });

  return json({ ok: true, result });
};
