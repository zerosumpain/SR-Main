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
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';
import { isDisplayOnlyType } from '$lib/workflows/types';
import { emitObs } from '$lib/workflows/observability-bus';
import { emitWorkflowEvent } from '$lib/workflows/events';

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

  // 3. Load previously-completed node outputs from node_executions.
  //    These are used to pre-seed the engine so it skips nodes whose
  //    outputs are already known.
  const executions = await db
    .select()
    .from(nodeExecutions)
    .where(eq(nodeExecutions.runId, runId));

  // Build a map of already-completed outputs (excluding the paused node itself).
  const seededOutputs: Record<string, Record<string, unknown>> = {};
  for (const exec of executions) {
    if (exec.status === 'completed' && exec.outputData && exec.nodeId !== pausedNodeId) {
      seededOutputs[exec.nodeId] = exec.outputData as Record<string, unknown>;
    }
  }

  // 4. Inject the resolved interaction output as the paused node's output.
  //    resolvedNodeOutput may be keyed by nodeId or contain a single entry.
  const resolvedOutput = resolvedNodeOutput[pausedNodeId] ?? Object.values(resolvedNodeOutput)[0];
  if (!resolvedOutput) {
    throw new Error(`resumeRun: resolvedNodeOutput does not contain output for node ${pausedNodeId}`);
  }
  seededOutputs[pausedNodeId] = resolvedOutput;

  // Persist the resolved output for the paused node in node_executions.
  await db
    .update(nodeExecutions)
    .set({
      status: 'completed',
      outputData: resolvedOutput,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(nodeExecutions.runId, runId),
        eq(nodeExecutions.nodeId, pausedNodeId),
      ),
    );

  // 5. Set the run back to 'running' and clear pausedAtNodeId.
  await db
    .update(workflowRuns)
    .set({
      status: 'running',
      pausedAtNodeId: null,
    })
    .where(eq(workflowRuns.id, runId));

  // 6. Re-enter the engine with pre-seeded outputs.
  //    The engine's topological walker will skip nodes whose outputs are
  //    already in nodeOutputs (seeded via initialInput won't work directly —
  //    we use a thin wrapper that pre-populates the engine's nodeOutputs map).
  //
  //    Strategy: We use the engine's PreSeeded execution mode by passing
  //    seededOutputs as the initialInput, but the engine merges input from
  //    upstream node outputs, not from initialInput, for non-root nodes.
  //    Instead we rely on the engine skipping nodes whose outputs are already
  //    in the seeded map via the `preSeededNodeOutputs` option.
  //
  //    The cleanest approach without engine refactoring: call engine.execute()
  //    with the pre-seeded outputs injected via the PreSeeded helper below.
  const originalStartedAt = run.startedAt?.getTime() ?? Date.now();

  engine
    .executeWithPreSeededOutputs(definition, runId, seededOutputs, workflowId)
    .then(async (result) => {
      const healingHistory = result.healingHistory || [];

      try {
        const isPaused = result.status === 'awaiting_human';
        const completedAt = isPaused ? undefined : new Date();
        await db
          .update(workflowRuns)
          .set({
            status: result.status,
            completedAt,
            error: result.error || null,
            healingHistory: healingHistory.length > 0 ? healingHistory : undefined,
            ...(isPaused ? { pausedAtNodeId: result.pausedAtNodeId ?? null } : {}),
          })
          .where(eq(workflowRuns.id, runId));

        if (completedAt && result.status === 'failed') {
          emitObs('run.failed', {
            workflowId,
            runId,
            error: result.error ?? 'run failed',
            completedAt: completedAt.toISOString(),
          });
        } else if (completedAt && result.status !== 'awaiting_human') {
          emitObs('run.completed', {
            workflowId,
            runId,
            status: result.status as 'completed' | 'completed_with_errors',
            completedAt: completedAt.toISOString(),
            durationMs: completedAt.getTime() - originalStartedAt,
          });
        }

        // Persist outputs for newly-executed nodes.
        for (const [nodeId, output] of result.nodeOutputs) {
          // Skip nodes that were pre-seeded (already persisted).
          if (seededOutputs[nodeId]) continue;
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
            .where(
              and(
                eq(nodeExecutions.runId, runId),
                eq(nodeExecutions.nodeId, nodeId),
              ),
            );
        }

        for (const [nodeId, error] of result.nodeErrors) {
          if (seededOutputs[nodeId]) continue;
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
            .where(
              and(
                eq(nodeExecutions.runId, runId),
                eq(nodeExecutions.nodeId, nodeId),
              ),
            );
        }
      } catch (err) {
        console.error(`[resume] Failed to persist resumed run results (runId=${runId})`, err);
      }
    })
    .catch(async (err) => {
      console.error(`[resume] Resumed workflow execution threw (runId=${runId})`, err);
      const message = err instanceof Error ? err.message : String(err);
      const failedAt = new Date();
      try {
        await db
          .update(workflowRuns)
          .set({
            status: 'failed',
            completedAt: failedAt,
            error: message,
          })
          .where(eq(workflowRuns.id, runId));
      } catch {
        /* swallow */
      }
      emitObs('run.failed', {
        workflowId,
        runId,
        error: message,
        completedAt: failedAt.toISOString(),
      });
    });
}
