import { db } from '$lib/db';
import { heartbeatPulses, heartbeatActivities } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ActivityResult } from './types';

const RING_SIZE = 200;
interface RingPulse extends ActivityResult {
  ts: number;
  activityId: string;
  activityName: string;
  durationMs: number;
}
const ring: RingPulse[] = [];

/** Recent pulses across all activities for the admin Pulse page Live tab. */
export function getRecentHeartbeatPulses(): RingPulse[] {
  return ring.slice().reverse();
}

export async function recordPulse(opts: {
  activityId: string;
  activityName: string;
  result: ActivityResult;
  durationMs: number;
  nextTickAt: Date;
}): Promise<void> {
  const ts = Date.now();
  ring.push({
    ts,
    activityId: opts.activityId,
    activityName: opts.activityName,
    durationMs: opts.durationMs,
    ...opts.result,
  });
  if (ring.length > RING_SIZE) ring.shift();

  await db.transaction(async (tx) => {
    await tx.insert(heartbeatPulses).values({
      activityId: opts.activityId,
      outcome: opts.result.outcome,
      summary: opts.result.summary.slice(0, 200),
      details: opts.result.details ?? null,
      durationMs: opts.durationMs,
      conversationId: opts.result.conversationId ?? null,
      jobId: opts.result.jobId ?? null,
    });
    await tx.update(heartbeatActivities)
      .set({
        lastTickAt: new Date(ts),
        nextTickAt: opts.nextTickAt,
        updatedAt: new Date(ts),
      })
      .where(eq(heartbeatActivities.id, opts.activityId));
  });
}
