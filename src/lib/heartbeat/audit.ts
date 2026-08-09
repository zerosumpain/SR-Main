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

/**
 * Failure budget. Before this existed an action that errored on every tick
 * re-fired at full cadence forever — the worst case logged 22,127 identical
 * errors over nine days and was stopped by a human, not by the engine.
 *
 * The first few failures are free (a transient DB blip shouldn't widen the
 * interval). After that the interval doubles per failure up to an hour, and
 * at PAUSE_AFTER the action is parked so someone can look at `last_error`.
 */
export const HEARTBEAT_BACKOFF_AFTER = 3;
export const HEARTBEAT_PAUSE_AFTER = 10;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

/** Recent pulses across all actions for the admin Pulse page Live tab. */
export function getRecentHeartbeatPulses(): RingPulse[] {
  return ring.slice().reverse();
}

/**
 * Widened interval for a failing action. Returns the unchanged cadence while
 * the action is inside its free-failure allowance.
 */
export function backoffDelayMs(cadenceSeconds: number, consecutiveFailures: number): number {
  const base = cadenceSeconds * 1000;
  if (consecutiveFailures <= HEARTBEAT_BACKOFF_AFTER) return base;
  const doublings = Math.min(consecutiveFailures - HEARTBEAT_BACKOFF_AFTER, 10);
  return Math.min(base * 2 ** doublings, MAX_BACKOFF_MS);
}

export async function recordPulse(opts: {
  actionId: string;
  actionName: string;
  result: ActivityResult;
  durationMs: number;
  nextRunAt: Date;
  /**
   * The action's pre-run state. Supplied by the engine so it can maintain the
   * failure budget; omitted by the admin "run now" route, where a one-off
   * manual fire should neither back off nor pause the action.
   */
  action?: { consecutiveFailures: number; cadenceSeconds: number };
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
  const failed = opts.result.outcome === 'error';

  // Failure bookkeeping. Without opts.action we keep the old behaviour so the
  // manual-run route is unaffected.
  let consecutiveFailures: number | undefined;
  let nextRunAt = opts.nextRunAt;
  let pause = false;
  if (opts.action) {
    consecutiveFailures = failed ? opts.action.consecutiveFailures + 1 : 0;
    pause = consecutiveFailures >= HEARTBEAT_PAUSE_AFTER;
    if (failed) {
      nextRunAt = new Date(ts + backoffDelayMs(opts.action.cadenceSeconds, consecutiveFailures));
    }
  }

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

    const counters = {
      totalRuns: sql`${heartbeatActions.totalRuns} + 1`,
      totalCostUsd: sql`${heartbeatActions.totalCostUsd} + ${cost}`,
      updatedAt: new Date(ts),
      ...(consecutiveFailures !== undefined
        ? { consecutiveFailures, lastError: failed ? opts.result.summary.slice(0, 500) : null }
        : {}),
    };

    if (opts.result.markDone) {
      await tx.update(heartbeatActions)
        .set({
          status: 'done',
          lastRunAt: new Date(ts),
          completedAt: new Date(ts),
          ...counters,
        })
        .where(eq(heartbeatActions.id, opts.actionId));
    } else {
      await tx.update(heartbeatActions)
        .set({
          lastRunAt: new Date(ts),
          nextRunAt,
          ...(pause ? { status: 'paused' as const } : {}),
          ...counters,
        })
        .where(eq(heartbeatActions.id, opts.actionId));
    }
  });

  if (pause) {
    console.warn(
      `[heartbeat] action ${opts.actionName} paused after ${consecutiveFailures} consecutive failures: ${opts.result.summary.slice(0, 200)}`,
    );
  }
}
