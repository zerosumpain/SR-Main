import { Cron } from 'croner';
import { db } from '$lib/db';
import { workflowSchedules, workflows, workflowNodes, workflowEdges, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';
import { isDisplayOnlyType } from '$lib/workflows/types';
import { emitObs } from '$lib/workflows/observability-bus';
import { cronTimezone } from '$lib/workflows/cron-timezone';
import { runsService } from './service-role';

// Tracks active Cron instances keyed by schedule ID
const activeJobs = new Map<string, Cron>();

/**
 * What each active job was registered WITH — `expression|timezone`.
 *
 * The reconciler compares against this to notice a schedule whose time was
 * changed by another process. Without it a reminder re-timed from WhatsApp
 * would keep firing at the old time, which looks far more like "the change did
 * not save" than like a scheduling bug.
 */
const registeredSignature = new Map<string, string>();

/**
 * Does THIS process own cron? Set by startScheduler(), which only the
 * scheduler-role process calls — and then only if it wins the leader lock.
 *
 * Registration is in-memory, so it is only ever correct in the owning process.
 * Every caller used to register unconditionally, which was fine while chat and
 * the seed routes only ever ran in the web app. WhatsApp chat now runs in
 * packages/jkai-wa-worker (JKAI_SERVICE_ROLE=whatsapp) — a process deliberately
 * built NOT to schedule, because "two schedulers on one database means every
 * cron fires twice". A reminder asked for over WhatsApp would have registered
 * its cron there: firing from the wrong process, and firing TWICE as soon as
 * the web process next restarted and picked the row up at boot.
 *
 * Seeded from the role so the web process behaves exactly as it always has —
 * a schedule created through the canvas or a seed route registers on the spot,
 * without waiting for startScheduler() to resolve. Under the run-worker flag
 * the role is not enough (two processes can both hold it), so ownership starts
 * false and is granted only by winning the leader lock.
 */
let cronOwner = process.env.JKAI_RUN_WORKER !== '1' && runsService('scheduler');

/** How often the owner re-syncs its cron jobs against the schedules table. */
const RECONCILE_INTERVAL_MS = 60_000;
let reconcilerStarted = false;

/** Read-only access to active in-memory cron jobs for diagnostics */
export function getActiveJobs(): ReadonlyMap<string, Cron> {
  return activeJobs;
}

export async function startScheduler(): Promise<void> {
  // #19 LEADER ELECTION (ADDITIVE, FEATURE-FLAGGED): when the durable run-worker
  // is enabled, the cron lane could fire in BOTH the web process and the worker
  // process. Gate cron registration on a pg advisory lock so exactly one process
  // owns scheduling and crons don't double-fire. When the flag is OFF this guard
  // is skipped entirely and the scheduler behaves exactly as today.
  if (process.env.JKAI_RUN_WORKER === '1') {
    const { tryAdvisoryLock, SCHEDULER_LOCK_LANE } = await import('./leader-lock');
    const isLeader = await tryAdvisoryLock(SCHEDULER_LOCK_LANE);
    if (!isLeader) {
      console.log('[scheduler] Not cron leader (advisory lock held elsewhere) — skipping cron registration');
      return;
    }
    console.log('[scheduler] Acquired cron leader lock');
  }

  // Before the first DB read, so an API request that lands mid-boot still
  // registers rather than silently waiting for the reconciler.
  cronOwner = true;

  console.log('[scheduler] Starting cron scheduler...');
  const schedules = await db
    .select()
    .from(workflowSchedules)
    .where(and(eq(workflowSchedules.type, 'cron'), eq(workflowSchedules.enabled, true)));

  // Per-schedule guard: one poison row (e.g. an invalid cron expression makes
  // `new Cron()` throw) must not abort registration of every later schedule.
  let registered = 0;
  for (const schedule of schedules) {
    try {
      registerCronJob(schedule);
      registered++;
    } catch (err) {
      console.error(
        `[scheduler] Failed to register schedule ${schedule.id} (workflow ${schedule.workflowId}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  console.log(`[scheduler] Registered ${registered}/${schedules.length} cron jobs`);
  startScheduleReconciler();
}

/**
 * Re-sync the in-memory cron jobs against the schedules table, every minute.
 *
 * Registration is process-local, so a schedule written by ANY other process is
 * invisible here until something reloads it. Until now the only writers were in
 * this process, so a direct registerCronJob() call was enough. That stopped
 * being true when WhatsApp chat moved to its own worker: a reminder created
 * from WhatsApp would sit in the table, enabled, and never run — the same
 * enabled-but-dormant failure the config.cron/config.expression mismatch caused
 * above, which is precisely the shape of bug nobody notices until the reminder
 * they were relying on does not arrive.
 *
 * A sweep rather than a cross-process nudge: no new endpoint, no new shared
 * secret, and it equally covers the run-worker, the seed routes, the workflow
 * doctor and a row edited by hand in psql. Started from startScheduler(), so it
 * inherits both the role gate and the leader lock and can never be the second
 * scheduler it exists to avoid.
 */
export function startScheduleReconciler(): void {
  if (reconcilerStarted) return;
  reconcilerStarted = true;
  setInterval(() => {
    void reconcileSchedules().catch((e) =>
      console.warn('[scheduler] reconcile failed:', e instanceof Error ? e.message : e),
    );
  }, RECONCILE_INTERVAL_MS).unref();
}

/** One reconcile pass. Exported for tests and for the ops probe. */
export async function reconcileSchedules(): Promise<{ added: number; removed: number }> {
  if (!cronOwner) return { added: 0, removed: 0 };
  const rows = await db
    .select()
    .from(workflowSchedules)
    .where(and(eq(workflowSchedules.type, 'cron'), eq(workflowSchedules.enabled, true)));

  const wanted = new Map(rows.map((r) => [r.id, r] as const));
  let added = 0;
  let removed = 0;

  // Gone or disabled elsewhere.
  for (const scheduleId of [...activeJobs.keys()]) {
    if (!wanted.has(scheduleId)) {
      unregisterCronJob(scheduleId);
      removed++;
    }
  }
  // New here, or re-timed elsewhere.
  for (const schedule of rows) {
    if (activeJobs.has(schedule.id) && registeredSignature.get(schedule.id) === scheduleSignature(schedule.config)) {
      continue;
    }
    try {
      registerCronJob(schedule);
      added++;
    } catch (err) {
      // Same per-row isolation as boot: one invalid cron expression must not
      // stop the rest of the sweep.
      console.error(
        `[scheduler] Reconcile could not register ${schedule.id} (workflow ${schedule.workflowId}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (added || removed) console.log(`[scheduler] Reconciled: +${added} -${removed}`);
  return { added, removed };
}

export function stopScheduler(): void {
  for (const [, job] of activeJobs) {
    job.stop();
  }
  activeJobs.clear();
  registeredSignature.clear();
  console.log('[scheduler] All cron jobs stopped');
}

/** `expression|timezone` — what a registration is, for change detection. */
function scheduleSignature(config: unknown): string {
  const cfg = (config ?? {}) as Record<string, unknown>;
  const expression =
    (typeof cfg.expression === 'string' && cfg.expression) ||
    (typeof cfg.cron === 'string' && cfg.cron) ||
    '';
  return `${expression}|${cronTimezone(cfg)}`;
}

export function registerCronJob(schedule: {
  id: string;
  workflowId: string;
  config: unknown;
}): void {
  // Only the cron owner may hold a live job. Everywhere else the row is written
  // and the owner's reconciler picks it up within the minute — that is what
  // makes "create a reminder" work from WhatsApp, which runs in a worker that
  // must never schedule anything itself. See `cronOwner`.
  if (!cronOwner) {
    console.log(
      `[scheduler] Schedule ${schedule.id} saved but not registered here` +
        ` (this process does not own cron) — the scheduler will pick it up within a minute.`,
    );
    return;
  }

  // Stop existing job for this schedule if any
  activeJobs.get(schedule.id)?.stop();
  activeJobs.delete(schedule.id);
  registeredSignature.delete(schedule.id);

  // Accept both `config.expression` (canonical) and `config.cron`. The
  // workflow_add_schedule / workflow_update_schedule MCP tools historically
  // stored the cron string under `config.cron` (per their own description),
  // but this runner only ever read `config.expression` — so any schedule added
  // via those tools saved fine but silently never registered in the in-memory
  // cron runner (enabled-but-dormant). Tolerating both keys here makes those
  // existing rows register on the next reload/boot without a data rewrite.
  const cfg = (schedule.config ?? {}) as Record<string, unknown>;
  const expression =
    (typeof cfg.expression === 'string' && cfg.expression) ||
    (typeof cfg.cron === 'string' && cfg.cron) ||
    undefined;
  if (!expression) {
    console.warn(`[scheduler] Schedule ${schedule.id} has no cron expression — skipping`);
    return;
  }

  // Without an explicit timezone croner uses server local time, which on the
  // VPS is UTC — so "0 20 * * *" fired at 21:00 through BST while the canvas UI
  // labelled it Europe/London. See $lib/workflows/cron-timezone.
  const timezone = cronTimezone(cfg);
  const job = new Cron(expression, { timezone }, async () => {
    await runScheduledWorkflow(schedule.workflowId, schedule.id);
  });

  activeJobs.set(schedule.id, job);
  registeredSignature.set(schedule.id, `${expression}|${timezone}`);
  console.log(`[scheduler] Registered schedule ${schedule.id} (${expression} ${timezone})`);
}

export function unregisterCronJob(scheduleId: string): void {
  activeJobs.get(scheduleId)?.stop();
  activeJobs.delete(scheduleId);
  registeredSignature.delete(scheduleId);
}

async function runScheduledWorkflow(workflowId: string, scheduleId: string): Promise<void> {
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);

  if (!workflow) {
    console.warn(`[scheduler] Workflow ${workflowId} not found, stopping job`);
    unregisterCronJob(scheduleId);
    return;
  }

  // #19 DISPATCH SWITCH (ADDITIVE, FEATURE-FLAGGED): in worker mode the row is
  // created 'pending' so the out-of-process worker claims it (vs 'running' for
  // the in-process path below). When the flag is OFF this is exactly the
  // original 'running' insert.
  const workerMode = process.env.JKAI_RUN_WORKER === '1';

  const [runRow] = await db
    .insert(workflowRuns)
    .values({
      workflowId,
      status: workerMode ? 'pending' : 'running',
      trigger: 'scheduled',
      startedAt: new Date(),
    })
    .returning();

  const runId = runRow.id;
  const now = new Date();
  console.log(`[scheduler] Starting run ${runId} for workflow ${workflowId}`);

  const runStartedAt = Date.now();
  emitObs('run.started', {
    workflowId,
    runId,
    trigger: 'scheduled',
    startedAt: new Date(runStartedAt).toISOString(),
  });

  try {
    const nodes = await db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, workflowId));
    const edges = await db
      .select()
      .from(workflowEdges)
      .where(eq(workflowEdges.workflowId, workflowId));

    const runnableNodes = nodes.filter((n) => !isDisplayOnlyType(n.type));
    const runnableEdges = edges.filter((e) => {
      const src = runnableNodes.find((n) => n.id === e.sourceNodeId);
      const tgt = runnableNodes.find((n) => n.id === e.targetNodeId);
      return src && tgt;
    });

    const definition: WorkflowDefinition = {
      id: workflowId,
      name: workflow.name,
      nodes: runnableNodes.map((n) => ({
        id: n.id,
        type: n.type,
        config: (n.config as Record<string, unknown>) ?? {},
        label: n.label ?? n.type,
        position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
      })),
      edges: runnableEdges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      })),
    };

    // Create pending node execution records so scheduled runs have the same
    // diagnostic trail as manual runs (see routes/api/workflows/[id]/run/+server.ts).
    for (const node of runnableNodes) {
      await db.insert(nodeExecutions).values({
        runId,
        nodeId: node.id,
        status: 'pending',
      });
    }

    // #19 DISPATCH SWITCH: in worker mode, ENQUEUE the (already-'pending') run
    // for the out-of-process worker and return — the worker persists results +
    // updates the schedule's lastRunAt/nextRunAt is still handled below for the
    // schedule bookkeeping. We update the schedule timestamps then bail out of
    // the in-process execute/persist path. When the flag is OFF this branch is
    // skipped and execution proceeds in-process exactly as before.
    if (workerMode) {
      const { enqueue } = await import('./run-queue');
      await enqueue(runId);
      const job = activeJobs.get(scheduleId);
      await db
        .update(workflowSchedules)
        .set({ lastRunAt: now, nextRunAt: job?.nextRun() ?? null })
        .where(eq(workflowSchedules.id, scheduleId));
      console.log(`[scheduler] Enqueued run ${runId} for run-worker (worker mode)`);
      return;
    }

    const result = await engine.execute(definition, runId, {}, undefined, workflowId);

    const completedAt = new Date();
    await db
      .update(workflowRuns)
      .set({ status: result.status, completedAt, error: result.error ?? null })
      .where(eq(workflowRuns.id, runId));

    if (result.status === 'failed') {
      emitObs('run.failed', {
        workflowId,
        runId,
        error: result.error ?? 'run failed',
        completedAt: completedAt.toISOString(),
      });
    } else if (result.status !== 'awaiting_human') {
      emitObs('run.completed', {
        workflowId,
        runId,
        status: result.status as 'completed' | 'completed_with_errors',
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - runStartedAt,
      });
    }

    // Update node execution records with inputs/outputs/status
    for (const [nodeId, output] of result.nodeOutputs) {
      const inputData = result.nodeInputs.get(nodeId);
      const usage = result.nodeUsage.get(nodeId);
      await db
        .update(nodeExecutions)
        .set({
          status: 'completed',
          startedAt: result.nodeStartTimes.get(nodeId) ?? undefined,
          inputData: inputData ?? null,
          outputData: output,
          completedAt: new Date(),
          ...(usage ?? {}),
        })
        .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.nodeId, nodeId)));
    }

    for (const [nodeId, error] of result.nodeErrors) {
      const usage = result.nodeUsage.get(nodeId);
      await db
        .update(nodeExecutions)
        .set({
          status: 'failed',
          startedAt: result.nodeStartTimes.get(nodeId) ?? undefined,
          error,
          completedAt: new Date(),
          ...(usage ?? {}),
        })
        .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.nodeId, nodeId)));
    }

    // Update lastRunAt/nextRunAt on the schedule
    const job = activeJobs.get(scheduleId);
    await db
      .update(workflowSchedules)
      .set({
        lastRunAt: now,
        nextRunAt: job?.nextRun() ?? null,
      })
      .where(eq(workflowSchedules.id, scheduleId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedAt = new Date();
    await db
      .update(workflowRuns)
      .set({ status: 'failed', completedAt: failedAt, error: message })
      .where(eq(workflowRuns.id, runId));
    console.error(`[scheduler] Run ${runId} failed:`, message);
    emitObs('run.failed', {
      workflowId,
      runId,
      error: message,
      completedAt: failedAt.toISOString(),
    });
  }
}

// Hot-reload: called when a schedule is created/updated/deleted via API
export async function reloadSchedule(scheduleId: string): Promise<void> {
  const [schedule] = await db
    .select()
    .from(workflowSchedules)
    .where(eq(workflowSchedules.id, scheduleId))
    .limit(1);

  if (!schedule || !schedule.enabled || schedule.type !== 'cron') {
    unregisterCronJob(scheduleId);
    return;
  }
  registerCronJob(schedule);
}
