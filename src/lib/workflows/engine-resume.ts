/**
 * engine-resume.ts
 *
 * Resume a workflow run that was paused at an `interactive-step` node.
 * The caller provides the resolved output for the paused node; the engine
 * re-enters the normal execution loop with all previously-completed node
 * outputs pre-seeded so the topological walker skips finished nodes.
 */

import { db } from '$lib/db';
import {
  workflowRuns,
  workflowNodes,
  workflowEdges,
  nodeExecutions,
  workflows,
  workflowInteractions,
} from '$lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { engine, registry } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';
import { isDisplayOnlyType } from '$lib/workflows/types';
import { emitWorkflowEvent } from '$lib/workflows/events';
import { buildResumeSeed } from './resume-seed';
import { finaliseRun, failRun, upsertNodeExecution } from './run-finalise';

export type ResolveInteractionReason =
  | 'not_pending'
  | 'cancelled';

export interface ResolveInteractionResult {
  resolved: boolean;
  reason?: ResolveInteractionReason;
}

/**
 * Resolve a pending workflow interaction and, if the run was paused
 * (`awaiting_human`), resume it. This is the single underlying code path the
 * canvas resolve API route uses — the inbound WhatsApp approval handler calls
 * it directly (no HTTP self-hop) so resume works identically in worker mode.
 *
 * Mirrors the route's semantics: flip resolvedAt/resolvedBy/formValues, emit the
 * `interaction_resolved` SSE event, and only call `resumeRun` when the run is
 * actually awaiting_human (a CAPTCHA-style inline interaction leaves the run in
 * `running` and its executor polls resolvedAt itself).
 */
export async function resolveInteraction(opts: {
  runId: string;
  nodeId: string;
  formValues: Record<string, unknown>;
  resolvedBy?: string | null;
}): Promise<ResolveInteractionResult> {
  const { runId, nodeId, formValues, resolvedBy = null } = opts;

  const [pending] = await db
    .select()
    .from(workflowInteractions)
    .where(
      and(
        eq(workflowInteractions.runId, runId),
        eq(workflowInteractions.nodeId, nodeId),
        isNull(workflowInteractions.resolvedAt),
      ),
    );

  if (!pending) return { resolved: false, reason: 'not_pending' };
  if (pending.cancelled) return { resolved: false, reason: 'cancelled' };

  await db
    .update(workflowInteractions)
    .set({ resolvedAt: new Date(), resolvedBy, formValues })
    .where(eq(workflowInteractions.id, pending.id));

  emitWorkflowEvent({
    type: 'interaction_resolved',
    runId,
    nodeId,
    data: { interactionId: pending.id },
    timestamp: new Date().toISOString(),
  });

  const [run] = await db
    .select({ status: workflowRuns.status })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId));

  if (run?.status === 'awaiting_human') {
    const nodeOutput = {
      completed: true,
      completedAt: new Date().toISOString(),
      formValues,
      durationMs: Date.now() - new Date(pending.openedAt).getTime(),
    };
    await resumeRun(runId, { [nodeId]: nodeOutput });
  }

  return { resolved: true };
}

/**
 * Resume a run that is currently in `awaiting_human` status.
 *
 * @param runId            The workflow_runs.id (text UUID) of the paused run.
 * @param resolvedNodeOutput  Map of nodeId -> output for the paused node only.
 *                            Format: { [nodeId]: { completed, completedAt, formValues, ... } }
 */
export async function resumeRun(
  runId: string,
  resolvedNodeOutput: Record<string, Record<string, unknown>>,
): Promise<void> {
  // 1. Load and validate the run row.
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId));

  if (!run) {
    throw new Error(`resumeRun: run ${runId} not found`);
  }
  if (run.status !== 'awaiting_human') {
    throw new Error(`resumeRun: run ${runId} is not awaiting_human (status=${run.status})`);
  }
  if (!run.pausedAtNodeId) {
    throw new Error(`resumeRun: run ${runId} has no pausedAtNodeId`);
  }

  const pausedNodeId = run.pausedAtNodeId;
  const workflowId = run.workflowId;

  // 2. Load the workflow definition.
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, workflowId));

  if (!workflow) {
    throw new Error(`resumeRun: workflow ${workflowId} not found`);
  }

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

  // 3. Load previously-completed node outputs AND the branch each one chose.
  //    Seeded nodes never execute again, so their routing must be replayed from
  //    what was recorded — otherwise every branch a conditional ruled out before
  //    the pause runs anyway, and both branches below a resumed approval run.
  const executions = await db
    .select()
    .from(nodeExecutions)
    .where(eq(nodeExecutions.runId, runId));

  // 4. The paused node's output comes from the human's resolution. A node that
  //    knows how (approval) turns it into its real output + selected handle.
  //    resolvedNodeOutput may be keyed by nodeId or contain a single entry.
  const resolvedOutput = resolvedNodeOutput[pausedNodeId] ?? Object.values(resolvedNodeOutput)[0];
  if (!resolvedOutput) {
    throw new Error(`resumeRun: resolvedNodeOutput does not contain output for node ${pausedNodeId}`);
  }
  const pausedNode = definition.nodes.find((n) => n.id === pausedNodeId);
  const pausedExec = executions.find((e) => e.nodeId === pausedNodeId);
  const seed = buildResumeSeed({
    executions,
    pausedNodeId,
    pausedNodeInput: (pausedExec?.inputData as Record<string, unknown> | null) ?? {},
    resolved: resolvedOutput,
    executor: pausedNode ? registry.getExecutor(pausedNode.type) : null,
  });
  const seededOutputs = seed.outputs;
  const seededNodeIds = new Set(Object.keys(seededOutputs));

  // Persist the paused node's resolved output (and branch) in node_executions.
  await upsertNodeExecution(runId, pausedNodeId, {
    status: 'completed',
    outputData: seededOutputs[pausedNodeId],
    selectedHandle: seed.handles[pausedNodeId] ?? null,
    completedAt: new Date(),
  });

  // 5. Set the run back to 'running' and clear pausedAtNodeId.
  await db
    .update(workflowRuns)
    .set({
      status: 'running',
      pausedAtNodeId: null,
    })
    .where(eq(workflowRuns.id, runId));

  // 6. Re-enter the engine with the pre-seeded outputs and handles; the
  //    topological walker skips every seeded node and re-applies its routing.
  const originalStartedAt = run.startedAt?.getTime() ?? Date.now();

  engine
    .executeWithPreSeededOutputs(definition, runId, seededOutputs, workflowId, undefined, seed.handles)
    .then((result) =>
      finaliseRun({
        workflowId,
        runId,
        result,
        runStartedAt: originalStartedAt,
        seededNodeIds,
        label: 'resume',
      }),
    )
    .catch((err) => {
      console.error(`[resume] Resumed workflow execution threw (runId=${runId})`, err);
      return failRun({ workflowId, runId, error: err, label: 'resume' });
    });
}
