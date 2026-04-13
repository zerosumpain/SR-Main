import { Cron } from 'croner';
import { db } from '$lib/db';
import { workflowSchedules, workflows, workflowNodes, workflowEdges, workflowRuns } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';

// Tracks active Cron instances keyed by schedule ID
const activeJobs = new Map<string, Cron>();

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

  try {
    const nodes = await db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, workflowId));
    const edges = await db
      .select()
      .from(workflowEdges)
      .where(eq(workflowEdges.workflowId, workflowId));

    const definition: WorkflowDefinition = {
      id: workflowId,
      name: workflow.name,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        config: (n.config as Record<string, unknown>) ?? {},
        label: n.label ?? n.type,
        position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      })),
    };

    const result = await engine.execute(definition, runId, {}, undefined, workflowId);

    await db
      .update(workflowRuns)
      .set({ status: result.status, completedAt: new Date(), error: result.error ?? null })
      .where(eq(workflowRuns.id, runId));

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
    await db
      .update(workflowRuns)
      .set({ status: 'failed', completedAt: new Date(), error: message })
      .where(eq(workflowRuns.id, runId));
    console.error(`[scheduler] Run ${runId} failed:`, message);
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
