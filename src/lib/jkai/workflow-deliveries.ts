import { db } from '$lib/db';
import {
  buildWorkflowSubscriptions,
  jkaiBuilds,
  pendingWorkflowDeliveries,
  workflowRuns,
  nodeExecutions,
  workflowNodes,
} from '$lib/db/schema';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { on as onPlatformEvent } from '$lib/workflows/event-bus';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'paused']);
const MAX_DELIVERY_OUTPUT_BYTES = 16_000;

let registered = false;

export function registerDeliveryListener(): void {
  if (registered) return;
  registered = true;
  onPlatformEvent('workflow_completed', async (event) => {
    const payload = event.payload as { workflowId?: string; runId?: string } | undefined;
    if (!payload?.workflowId || !payload.runId) return;
    try {
      await deliverRunToSubscribers(payload.workflowId, payload.runId, 'subscription');
    } catch (err) {
      console.error('[workflow-deliveries] failed to fan out run', payload.runId, err);
    }
  });
}

export async function deliverRunToSubscribers(workflowId: string, runId: string, source: 'subscription' | 'manual'): Promise<number> {
  const subs = await db
    .select({ buildId: buildWorkflowSubscriptions.buildId })
    .from(buildWorkflowSubscriptions)
    .where(eq(buildWorkflowSubscriptions.workflowId, workflowId));
  if (subs.length === 0 && source === 'subscription') return 0;

  const output = await snapshotRunOutput(runId);

  let inserted = 0;
  for (const sub of subs) {
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, sub.buildId));
    if (!build || TERMINAL_STATUSES.has(build.status)) continue;
    await db.insert(pendingWorkflowDeliveries).values({
      buildId: sub.buildId,
      workflowId,
      runId,
      output,
      source,
    });
    inserted++;
  }
  return inserted;
}

export async function deliverManualToBuild(buildId: string, workflowId: string, runId: string): Promise<void> {
  const output = await snapshotRunOutput(runId);
  await db.insert(pendingWorkflowDeliveries).values({
    buildId,
    workflowId,
    runId,
    output,
    source: 'manual',
  });
}

async function snapshotRunOutput(runId: string): Promise<Record<string, unknown>> {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
  const execs = await db
    .select({
      nodeId: nodeExecutions.nodeId,
      status: nodeExecutions.status,
      outputData: nodeExecutions.outputData,
      error: nodeExecutions.error,
      label: workflowNodes.label,
      type: workflowNodes.type,
    })
    .from(nodeExecutions)
    .leftJoin(workflowNodes, eq(workflowNodes.id, nodeExecutions.nodeId))
    .where(eq(nodeExecutions.runId, runId))
    .orderBy(asc(nodeExecutions.startedAt));

  const compact = execs.map((e) => ({
    nodeId: e.nodeId,
    label: e.label ?? e.nodeId,
    type: e.type ?? 'unknown',
    status: e.status,
    output: e.outputData ?? null,
    error: e.error ?? null,
  }));

  const truncate = JSON.stringify(compact);
  if (truncate.length > MAX_DELIVERY_OUTPUT_BYTES) {
    return {
      runId,
      status: run?.status ?? 'unknown',
      truncated: true,
      summary: compact.map((c) => ({ nodeId: c.nodeId, label: c.label, status: c.status })),
      hint: 'Full payload exceeds 16 KB — call workflow_get_run for the unabbreviated result.',
    };
  }

  return {
    runId,
    status: run?.status ?? 'unknown',
    truncated: false,
    nodes: compact,
  };
}

export async function consumePendingDeliveries(buildId: string, limit = 10): Promise<Array<{ workflowId: string; runId: string; source: string; output: unknown }>> {
  const rows = await db
    .select()
    .from(pendingWorkflowDeliveries)
    .where(and(eq(pendingWorkflowDeliveries.buildId, buildId), isNull(pendingWorkflowDeliveries.consumedAt)))
    .orderBy(desc(pendingWorkflowDeliveries.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  await db
    .update(pendingWorkflowDeliveries)
    .set({ consumedAt: new Date() })
    .where(inArray(pendingWorkflowDeliveries.id, rows.map((r) => r.id)));

  return rows.map((r) => ({
    workflowId: r.workflowId,
    runId: r.runId,
    source: r.source,
    output: r.output,
  }));
}
