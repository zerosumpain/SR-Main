/**
 * Forge trigger scheduler — cron-scheduled and autonomous (backlog-driven)
 * brass-and-rails builds. Mirrors the workflow cron scheduler
 * (`$lib/workflows/scheduler.ts`):
 *
 *  - leader-elected via a pg advisory lock (its OWN distinct lane,
 *    `FORGE_SCHEDULER_LOCK_LANE`) when the durable run-worker is enabled, so
 *    the lane never double-fires across the web + worker processes;
 *  - one in-memory `croner` `Cron` per enabled `forge_schedules` row;
 *  - a reconcile job (every minute) re-reads the table every ~60s so API
 *    changes (enable/disable/cron edit/delete) propagate without any
 *    cross-process signaling.
 *
 * On fire a job creates a Forge git-target build via `createForgeBuild`
 * (shared with the propose route) and stamps `last_run_at` / `last_build_id`.
 */
import { Cron } from 'croner';
import { db } from '$lib/db';
import { forgeSchedules, jkaiBuilds } from '$lib/db/schema';
import { cronTimezone } from '$lib/workflows/cron-timezone';
import { eq, and } from 'drizzle-orm';
import type { ForgeSchedule } from '$lib/db/schema';
import { createForgeBuild } from '$lib/jkai/forge';

// Tracks active Cron instances keyed by forge_schedules.id (plus the special
// reconcile job under RECONCILE_KEY).
const activeJobs = new Map<string, Cron>();

const RECONCILE_KEY = '__forge_reconcile__';
const RECONCILE_CRON = '*/1 * * * *';

/**
 * The directive the agent receives for an autonomous (backlog-driven) run.
 * Points it at the repo's ROADMAP.md and tells it to do exactly one item.
 */
export const AUTONOMOUS_PROMPT =
  'Autonomous Forge run. Open ROADMAP.md at the repository root. Choose the single ' +
  'highest-priority unchecked `- [ ]` item, implement it with the smallest reasonable ' +
  'change that fits the existing design, then check it off (change `- [ ]` to `- [x]`) ' +
  'in the same change. Ensure `npm run gate` passes. If ROADMAP.md is missing, empty, ' +
  'or every item is already checked, make NO changes and stop.';

/** Read-only access to active in-memory cron jobs for diagnostics. */
export function getActiveJobs(): ReadonlyMap<string, Cron> {
  return activeJobs;
}

export async function startForgeScheduler(): Promise<void> {
  // LEADER ELECTION (mirrors the workflow scheduler): when the durable
  // run-worker is enabled the Forge cron lane could fire in BOTH the web
  // process and the worker process. Gate registration on a pg advisory lock
  // — its OWN distinct lane — so exactly one process owns Forge scheduling.
  // When the flag is OFF this guard is skipped entirely.
  if (process.env.JKAI_RUN_WORKER === '1') {
    const { tryAdvisoryLock, FORGE_SCHEDULER_LOCK_LANE } = await import(
      '$lib/workflows/leader-lock'
    );
    const isLeader = await tryAdvisoryLock(FORGE_SCHEDULER_LOCK_LANE);
    if (!isLeader) {
      console.log(
        '[forge-scheduler] Not forge leader (advisory lock held elsewhere) — skipping registration',
      );
      return;
    }
    console.log('[forge-scheduler] Acquired forge leader lock');
  }

  console.log('[forge-scheduler] Starting forge cron scheduler...');
  const schedules = await db
    .select()
    .from(forgeSchedules)
    .where(eq(forgeSchedules.enabled, true));

  for (const schedule of schedules) {
    registerForgeJob(schedule);
  }
  console.log(`[forge-scheduler] Registered ${schedules.length} forge jobs`);

  // Reconcile loop: re-read the table every ~60s and converge the in-memory
  // job set onto it, so API mutations propagate without cross-process signals.
  activeJobs.get(RECONCILE_KEY)?.stop();
  const reconcileJob = new Cron(RECONCILE_CRON, async () => {
    try {
      await reconcileForgeJobs();
    } catch (err) {
      console.error('[forge-scheduler] reconcile failed:', err instanceof Error ? err.message : err);
    }
  });
  activeJobs.set(RECONCILE_KEY, reconcileJob);
}

export function stopForgeScheduler(): void {
  for (const [, job] of activeJobs) {
    job.stop();
  }
  activeJobs.clear();
  console.log('[forge-scheduler] All forge jobs stopped');
}

/**
 * Re-read enabled forge_schedules and converge the in-memory job set: register
 * newly-enabled rows and unregister jobs whose row is now disabled or deleted.
 * The reconcile job itself (RECONCILE_KEY) is never touched.
 */
async function reconcileForgeJobs(): Promise<void> {
  const enabled = await db
    .select()
    .from(forgeSchedules)
    .where(eq(forgeSchedules.enabled, true));
  const enabledById = new Map(enabled.map((s) => [s.id, s]));

  // Remove jobs that are no longer enabled / no longer exist.
  for (const id of [...activeJobs.keys()]) {
    if (id === RECONCILE_KEY) continue;
    if (!enabledById.has(id)) {
      activeJobs.get(id)?.stop();
      activeJobs.delete(id);
    }
  }

  // Add jobs for newly-enabled rows.
  for (const schedule of enabled) {
    if (!activeJobs.has(schedule.id)) {
      registerForgeJob(schedule);
    }
  }
}

export function registerForgeJob(schedule: ForgeSchedule): void {
  // Stop any existing job for this schedule first.
  activeJobs.get(schedule.id)?.stop();
  activeJobs.delete(schedule.id);

  // Same reason as the workflow scheduler: no timezone means server local time,
  // which is UTC on the VPS. A forge schedule is a wall-clock time a human
  // chose, so it has to be interpreted in theirs.
  let job: Cron;
  try {
    job = new Cron(schedule.cron, { timezone: cronTimezone(schedule) }, async () => {
      await fireForgeSchedule(schedule);
    });
  } catch (err) {
    console.warn(
      `[forge-scheduler] Schedule ${schedule.id} has an invalid cron (${schedule.cron}) — skipping:`,
      err instanceof Error ? err.message : err,
    );
    return;
  }

  activeJobs.set(schedule.id, job);
}

async function fireForgeSchedule(schedule: ForgeSchedule): Promise<void> {
  try {
    // Avoid piling up: if a forge build is already running, skip this fire.
    const [running] = await db
      .select({ id: jkaiBuilds.id })
      .from(jkaiBuilds)
      .where(and(eq(jkaiBuilds.origin, 'forge'), eq(jkaiBuilds.status, 'running')))
      .limit(1);
    if (running) {
      console.log(
        `[forge-scheduler] Forge build ${running.id} already running — skipping schedule ${schedule.id}`,
      );
      return;
    }

    const prompt = resolvePrompt(schedule);
    const { buildId } = await createForgeBuild({ prompt, trigger: schedule.mode });

    await db
      .update(forgeSchedules)
      .set({ lastRunAt: new Date(), lastBuildId: buildId })
      .where(eq(forgeSchedules.id, schedule.id));

    console.log(
      `[forge-scheduler] Schedule ${schedule.id} (${schedule.mode}) fired — build ${buildId}`,
    );
  } catch (err) {
    // Never throw out of the cron callback.
    console.error(
      `[forge-scheduler] Schedule ${schedule.id} fire failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Resolve the agent directive for a schedule fire. */
function resolvePrompt(schedule: ForgeSchedule): string {
  if (schedule.mode === 'autonomous') {
    const extra = schedule.directive?.trim();
    return extra ? `${AUTONOMOUS_PROMPT}\n\nAdditional guidance: ${extra}` : AUTONOMOUS_PROMPT;
  }
  // scheduled mode: the directive IS the prompt.
  return schedule.directive;
}
