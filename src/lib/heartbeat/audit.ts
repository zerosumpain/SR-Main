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

/**
 * A watch that is SUCCEEDING has no budget at all, and that is how three of
 * them ran to 43,115, 17,082 and 3,584 ticks before a human stopped them by
 * hand on 2026-08-24. The failure budget above never applied: every one of
 * those pulses was an `ok`.
 *
 * A `targeted` watch retires by reaching a terminal task state — `markDone`.
 * Whether it CAN do that depends on whether it has a task to watch:
 *
 *   - **Bound** (`config` carries `taskKind` + `taskId`): a state provider can
 *     report terminal, so it retires on its own. The cap is a backstop for a
 *     provider that never says so.
 *   - **Unbound** (`config` is `{}` — every watch the model registers without
 *     those arguments): `buildTaskState` returns null, `terminal` is never
 *     true, and `markDone` is never set. It can NEVER retire. Nothing else in
 *     the module stops it.
 *
 * So the ceilings differ by how possible self-retirement is, and the unbound
 * one is short. Dropping the elapsed label from the post — the other obvious
 * fix — would only have made an immortal watcher quiet.
 *
 * `system-scan` actions are exempt: they are infrastructure, they are supposed
 * to run for ever, and they have run 150,505 times doing their job.
 */
export const UNBOUND_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const BOUND_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const TARGETED_MAX_RUNS = 5_000;

/**
 * How long a pulse row is worth keeping.
 *
 * `heartbeat_pulses` had no retention at all and reached 308,639 rows / 111MB
 * by 2026-08-25, going back to 2026-05-06 — the great majority of it the
 * `suppressed` no-change ticks of watches that should have retired. The recent
 * ones answer "is this thing running and what did it just say", which is all
 * anything reads them for; the six-week-old ones answer nothing.
 */
export const PULSE_RETENTION_DAYS = 14;

/**
 * Delete pulse rows older than the retention window.
 *
 * Bounded per call so a first run against a very large table does not hold a
 * long transaction — it simply takes a few ticks to catch up. Never throws:
 * housekeeping must not be able to stop the engine.
 */
export async function prunePulses(limit = 20_000): Promise<number> {
  try {
    const res = await db.execute(sql`
      DELETE FROM heartbeat_pulses
      WHERE id IN (
        SELECT id FROM heartbeat_pulses
        WHERE ts < now() - (${PULSE_RETENTION_DAYS} || ' days')::interval
        ORDER BY ts
        LIMIT ${limit}
      )
    `);
    const n = (res as unknown as { rowCount?: number }).rowCount ?? 0;
    if (n > 0) console.log(`[heartbeat] pruned ${n} pulse rows older than ${PULSE_RETENTION_DAYS} days`);
    return n;
  } catch (err) {
    console.error('[heartbeat] pulse prune failed:', err instanceof Error ? err.message : err);
    return 0;
  }
}

/**
 * Should this tick be the watch's last? Pure, so the arithmetic is testable
 * without a database.
 *
 * Returns the reason rather than a boolean: it is written into `last_error` so
 * the row says why it stopped, which is the question anyone looking at a
 * retired watch actually has.
 */
export function watchExpiry(a: {
  kind: string;
  createdAt: Date;
  totalRuns: number;
  config: unknown;
  now?: number;
}): { expired: false } | { expired: true; reason: string } {
  if (a.kind !== 'targeted') return { expired: false };

  const cfg = (a.config ?? {}) as { taskKind?: unknown; taskId?: unknown };
  const bound = typeof cfg.taskKind === 'string' && typeof cfg.taskId === 'string';
  const now = a.now ?? Date.now();
  const ageMs = now - a.createdAt.getTime();
  const maxAge = bound ? BOUND_MAX_AGE_MS : UNBOUND_MAX_AGE_MS;

  // `+ 1` because this call happens before the counter is written.
  const runs = a.totalRuns + 1;
  if (runs >= TARGETED_MAX_RUNS) {
    return { expired: true, reason: `run cap reached (${runs} ticks)` };
  }
  if (ageMs >= maxAge) {
    const hours = Math.round(ageMs / 3_600_000);
    return {
      expired: true,
      reason: bound
        ? `age cap reached (${hours}h; its task never reported a terminal state)`
        : `age cap reached (${hours}h; no task binding, so it could never retire itself)`,
    };
  }
  return { expired: false };
}
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

  // Has this watch outlived its ability to retire itself? Read outside the
  // transaction: it is one indexed primary-key lookup and it must not widen the
  // window the pulse insert holds.
  let expiry: { expired: false } | { expired: true; reason: string } = { expired: false };
  try {
    const [row] = await db
      .select({
        kind: heartbeatActions.kind,
        createdAt: heartbeatActions.createdAt,
        totalRuns: heartbeatActions.totalRuns,
        config: heartbeatActions.config,
      })
      .from(heartbeatActions)
      .where(eq(heartbeatActions.id, opts.actionId))
      .limit(1);
    if (row) expiry = watchExpiry({ ...row, now: ts });
  } catch {
    // A failed lookup must not cost the pulse. Worst case the watch survives
    // one more tick and is caught on the next.
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

    if (opts.result.markDone || expiry.expired) {
      await tx.update(heartbeatActions)
        .set({
          status: 'done',
          lastRunAt: new Date(ts),
          completedAt: new Date(ts),
          ...counters,
          // Say why it stopped. A watch that hit a ceiling and one that finished
          // its job both read `done`, and only one of them is a success.
          ...(expiry.expired && !opts.result.markDone
            ? { lastError: `retired: ${expiry.reason}` }
            : {}),
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

  if (expiry.expired && !opts.result.markDone) {
    console.warn(
      `[heartbeat] action ${opts.actionName} retired — ${expiry.reason}. ` +
        'It was still succeeding; a watch with nothing to complete needs a ceiling, not a failure budget.',
    );
  }

  if (pause) {
    console.warn(
      `[heartbeat] action ${opts.actionName} paused after ${consecutiveFailures} consecutive failures: ${opts.result.summary.slice(0, 200)}`,
    );
  }
}
