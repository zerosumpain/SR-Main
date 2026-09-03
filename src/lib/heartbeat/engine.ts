import os from 'node:os';
import { db } from '$lib/db';
import { heartbeatActions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getHandler } from './registry';
import { withActivity } from '$lib/context/activity';
import { recordPulse, prunePulses } from './audit';
import { seedDefaultActions } from './seed';
import { runTargetedAction } from './handlers/targeted';
import { withinActiveHours, rescheduleAfterWindowSkip } from './schedule';
import type { HeartbeatAction } from '$lib/db/schema';

// The engine ticks at this cadence. Per-action `cadence_seconds` floors here
// in practice (no point setting a 5s action when the engine fires every 30s),
// but the column itself accepts anything ≥ 30.
const ENGINE_TICK_MS = 30_000;

let engineTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Actions currently mid-run. `runOne` is fired without awaiting so one slow
 * action can't hold up the tick, which means an action taking longer than
 * ENGINE_TICK_MS would otherwise be re-entered by the next tick — its
 * next_run_at only advances once it finishes. No second replica required.
 */
const inFlight = new Set<string>();

export async function startHeartbeatEngine(): Promise<void> {
  if (started) return;
  started = true;
  console.log('[heartbeat] starting engine');
  try {
    await seedDefaultActions();
  } catch (err) {
    console.error('[heartbeat] seed failed:', err);
  }

  // Prod-only gate, same shape as the self-improvement engine's. Nothing
  // prevents two engines sharing a database — runTick selects due rows and
  // fires them with no lock or lease — and today only homeserv's DATABASE_URL
  // pointing at its own Postgres keeps them apart. That isolation is a
  // config accident, not a design.
  const host = os.hostname();
  if (host === 'homeserv' && process.env.HEARTBEAT_ALLOW_DEV !== '1') {
    console.log(
      '[heartbeat] host is homeserv — ticker disabled (seeds still ran). Set HEARTBEAT_ALLOW_DEV=1 to enable locally.',
    );
    return;
  }

  // One tick now so anything overdue runs without waiting 30s.
  void runTick().catch((e) => console.error('[heartbeat] initial tick failed:', e));
  engineTimer = setInterval(() => {
    void runTick().catch((e) => console.error('[heartbeat] tick failed:', e));
  }, ENGINE_TICK_MS);
}

export function stopHeartbeatEngine(): void {
  if (engineTimer) clearInterval(engineTimer);
  engineTimer = null;
  started = false;
  console.log('[heartbeat] engine stopped');
}

/** Ticks between prune attempts. The engine runs every 30s, so this is hourly
 *  — often enough to keep up, rare enough to be invisible. */
const PRUNE_EVERY_TICKS = 120;
let tickCount = 0;

async function runTick(): Promise<void> {
  const now = new Date();

  // Housekeeping, unawaited: the pulse table had no retention and reached
  // 308,639 rows before anyone looked. Nothing reads a six-week-old pulse.
  if (tickCount++ % PRUNE_EVERY_TICKS === 0) {
    void prunePulses();
  }
  const rows = await db
    .select()
    .from(heartbeatActions)
    .where(eq(heartbeatActions.status, 'active'));

  for (const row of rows) {
    const dueAt = row.nextRunAt ?? new Date(0);
    if (dueAt.getTime() > now.getTime()) continue;
    if (inFlight.has(row.id)) continue;
    inFlight.add(row.id);
    void runOne(row, now)
      .catch((e) => console.error(`[heartbeat] action ${row.name} crashed:`, e))
      .finally(() => inFlight.delete(row.id));
  }
}

async function runOne(row: HeartbeatAction, now: Date): Promise<void> {
  const startedAt = Date.now();
  const nextRunAt = new Date(now.getTime() + row.cadenceSeconds * 1000);

  if (!withinActiveHours(row, now)) {
    // Re-schedule to when the window NEXT OPENS, not to now + cadence.
    //
    // The old line kept the run time on a fixed wall-clock phase, so any
    // action whose cadence divided into a day and whose phase sat outside its
    // window skipped forever: daydream-bank had never run once, and
    // daydream-weekly had never sent a letter. See ./schedule.ts for the
    // measurements. A skip is not a run, and this can only ever move the time
    // later, so the cadence remains a floor.
    const retryAt = rescheduleAfterWindowSkip(row, now, nextRunAt);

    // No `action` — a skip is neither a success nor a failure, so it must not
    // reset the failure budget of an action that is genuinely broken.
    await recordPulse({
      actionId: row.id,
      actionName: row.name,
      result: {
        outcome: 'skipped',
        summary: `outside active hours — next window ${retryAt.toISOString()}`,
      },
      durationMs: Date.now() - startedAt,
      nextRunAt: retryAt,
    });
    return;
  }

  let result;
  try {
    if (row.kind === 'system-scan') {
      const handler = getHandler(row.name);
      if (!handler) {
        result = { outcome: 'skipped' as const, summary: `no handler registered for ${row.name}` };
      } else {
        // Tagged with the activity's name so every LLM call it makes lands in
        // the ledger under it — before this, 9,889 of the month's calls sat in
        // an untagged bucket and no room could say what an activity cost. An
        // inner tag (self-improve wraps its own calls) still wins.
        result = await withActivity(row.name, () =>
          handler.run({
            now: now.getTime(),
            config: (row.config as Record<string, unknown>) ?? {},
            action: row,
          }),
        );
      }
    } else if (row.kind === 'targeted') {
      result = await runTargetedAction(row);
    } else {
      result = { outcome: 'skipped' as const, summary: `unknown kind ${row.kind}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[heartbeat] action ${row.name} threw:`, msg);
    result = { outcome: 'error' as const, summary: msg.slice(0, 200) };
  }

  await recordPulse({
    actionId: row.id,
    actionName: row.name,
    result,
    durationMs: Date.now() - startedAt,
    nextRunAt,
    action: { consecutiveFailures: row.consecutiveFailures, cadenceSeconds: row.cadenceSeconds },
  });
}
