import { db } from '$lib/db';
import { heartbeatPulses, heartbeatActions } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { ActivityResult } from './types';

const RING_SIZE = 200;
interface RingPulse extends ActivityResult {
  ts: number;
  actionId: string;
  actionName: string;
  durationMs: number;
}
const ring: RingPulse[] = [];

/** Recent pulses across all actions for the admin Pulse page Live tab. */
export function getRecentHeartbeatPulses(): RingPulse[] {
  return ring.slice().reverse();
}

export async function recordPulse(opts: {
  actionId: string;
  actionName: string;
  result: ActivityResult;
  durationMs: number;
  nextRunAt: Date;
}): Promise<void> {
  const ts = Date.now();
  ring.push({
    ts,
    actionId: opts.actionId,
    actionName: opts.actionName,
    durationMs: opts.durationMs,
    ...opts.result,
  });
  if (ring.length > RING_SIZE) ring.shift();

  const cost = opts.result.costUsd ?? 0;

  await db.transaction(async (tx) => {
    await tx.insert(heartbeatPulses).values({
      actionId: opts.actionId,
      outcome: opts.result.outcome,
      summary: opts.result.summary.slice(0, 200),
      details: opts.result.details ?? null,
      durationMs: opts.durationMs,
      conversationId: opts.result.conversationId ?? null,
      jobId: opts.result.jobId ?? null,
      costUsd: cost.toFixed(6),
    });

    if (opts.result.markDone) {
      await tx.update(heartbeatActions)
        .set({
          status: 'done',
          lastRunAt: new Date(ts),
          completedAt: new Date(ts),
          totalRuns: sql`${heartbeatActions.totalRuns} + 1`,
          totalCostUsd: sql`${heartbeatActions.totalCostUsd} + ${cost}`,
          updatedAt: new Date(ts),
        })
        .where(eq(heartbeatActions.id, opts.actionId));
    } else {
      await tx.update(heartbeatActions)
        .set({
          lastRunAt: new Date(ts),
          nextRunAt: opts.nextRunAt,
          totalRuns: sql`${heartbeatActions.totalRuns} + 1`,
          totalCostUsd: sql`${heartbeatActions.totalCostUsd} + ${cost}`,
          updatedAt: new Date(ts),
        })
        .where(eq(heartbeatActions.id, opts.actionId));
    }
  });
}
