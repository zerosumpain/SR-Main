import { Cron } from 'croner';
import { db } from '$lib/db';
import { workflowSchedules, workflows, workflowNodes, workflowEdges, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';
import { isDisplayOnlyType } from '$lib/workflows/types';
import { emitObs } from '$lib/workflows/observability-bus';

// Tracks active Cron instances keyed by schedule ID
const activeJobs = new Map<string, Cron>();

/** Read-only access to active in-memory cron jobs for diagnostics */
export function getActiveJobs(): ReadonlyMap<string, Cron> {
  return activeJobs;
}

export async function startScheduler(): Promise<void> {
  console.log('[scheduler] Starting cron scheduler...');
  const schedules = await db
    .select()
    .from(workflowSchedules)
    .where(and(eq(workflowSchedules.type, 'cron'), eq(workflowSchedules.enabled, true)));

  for (const schedule of schedules) {
    registerCronJob(schedule);
  }
  console.log(`[scheduler] Registered ${schedules.length} cron jobs`);
}

export function stopScheduler(): void {
  for (const [, job] of activeJobs) {
    job.stop();
  }
  activeJobs.clear();
  console.log('[scheduler] All cron jobs stopped');
}

export function registerCronJob(schedule: {
  id: string;
  workflowId: string;
  config: unknown;
}): void {
  // Stop existing job for this schedule if any
  activeJobs.get(schedule.id)?.stop();
  activeJobs.delete(schedule.id);

  const expression = (schedule.config as Record<string, unknown>)?.expression as string | undefined;
  if (!expression) {
    console.warn(`[scheduler] Schedule ${schedule.id} has no cron expression — skipping`);
    return;
  }

  const job = new Cron(expression, async () => {
    await runScheduledWorkflow(schedule.workflowId, schedule.id);
  });

  activeJobs.set(schedule.id, job);
}

export function unregisterCronJob(scheduleId: string): void {
  activeJobs.get(scheduleId)?.stop();
  activeJobs.delete(scheduleId);
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

  const [runRow] = await db
    .insert(workflowRuns)
    .values({
      workflowId,
      status: 'running',
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
