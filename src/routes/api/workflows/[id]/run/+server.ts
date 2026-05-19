import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';
import { isDisplayOnlyType } from '$lib/workflows/types';
import { emitObs } from '$lib/workflows/observability-bus';

export const POST: RequestHandler = async ({ params, request }) => {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!workflow) {
    return json({ error: 'Workflow not found' }, { status: 404 });
  }

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, params.id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, params.id));

  const body = await request.json().catch(() => ({}));
  const initialInput = body.input || {};
  const breakpointNodeIds: string[] = Array.isArray(body.breakpoints) ? body.breakpoints : [];
  const breakpoints = breakpointNodeIds.length > 0 ? new Set<string>(breakpointNodeIds) : undefined;
  const selfHealing = body.selfHealing !== false;

  const [run] = await db.insert(workflowRuns).values({
    workflowId: params.id,
    status: 'running',
    trigger: 'manual',
    startedAt: new Date(),
  }).returning();

  const runnableNodes = nodes.filter((n) => !isDisplayOnlyType(n.type));
  const runnableEdges = edges.filter((e) => {
    const src = runnableNodes.find((n) => n.id === e.sourceNodeId);
    const tgt = runnableNodes.find((n) => n.id === e.targetNodeId);
    return src && tgt;
  });

  // Create pending node execution records
  for (const node of runnableNodes) {
    await db.insert(nodeExecutions).values({
      runId: run.id,
      nodeId: node.id,
      status: 'pending',
    });
  }

  const definition: WorkflowDefinition = {
    id: workflow.id,
    name: workflow.name,
    nodes: runnableNodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position as { x: number; y: number },
      config: (n.config || {}) as Record<string, unknown>,
      label: n.label,
    })),
    edges: runnableEdges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };

  const runStartedAt = Date.now();
  emitObs('run.started', {
    workflowId: params.id,
    runId: run.id,
    trigger: 'manual',
    startedAt: new Date(runStartedAt).toISOString(),
  });

  // Execute in background — don't await
  engine.execute(definition, run.id, initialInput, breakpoints, params.id, { selfHealing }).then(async (result) => {
    const healingHistory = result.healingHistory || [];

    // For awaiting_human: don't set completedAt; persist pausedAtNodeId instead.
    const isPaused = result.status === 'awaiting_human';
    const completedAt = isPaused ? undefined : new Date();
    await db.update(workflowRuns).set({
      status: result.status,
      completedAt,
      error: result.error || null,
      healingHistory: healingHistory.length > 0 ? healingHistory : undefined,
      ...(isPaused ? { pausedAtNodeId: result.pausedAtNodeId ?? null } : {}),
    }).where(eq(workflowRuns.id, run.id));

    if (completedAt && result.status === 'failed') {
      emitObs('run.failed', {
        workflowId: params.id,
        runId: run.id,
        error: result.error ?? 'run failed',
        completedAt: completedAt.toISOString(),
      });
    } else if (completedAt && result.status !== 'awaiting_human') {
      emitObs('run.completed', {
        workflowId: params.id,
        runId: run.id,
        status: result.status as 'completed' | 'completed_with_errors',
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - runStartedAt,
      });
    }

    // Emit workflow_completed event so event-triggered workflows can chain
    if (result.status === 'completed' || result.status === 'completed_with_errors') {
      try {
        const { emit } = await import('$lib/workflows/event-bus');
        emit('workflow_completed', { workflowId: params.id, runId: run.id, status: result.status });
      } catch {
        // event-bus not critical path
      }
    }

    // Update node execution records
    for (const [nodeId, output] of result.nodeOutputs) {
      const inputData = result.nodeInputs.get(nodeId);
      const usage = result.nodeUsage.get(nodeId);
      await db.update(nodeExecutions).set({
        status: 'completed',
        inputData: inputData ?? null,
        outputData: output,
        completedAt: new Date(),
        ...(usage ?? {}),
      }).where(
        eq(nodeExecutions.nodeId, nodeId),
      );
    }

    for (const [nodeId, error] of result.nodeErrors) {
      const usage = result.nodeUsage.get(nodeId);
      await db.update(nodeExecutions).set({
        status: 'failed',
        error,
        completedAt: new Date(),
        ...(usage ?? {}),
      }).where(
        eq(nodeExecutions.nodeId, nodeId),
      );
    }

    // Persist healed node configs to the workflow
    for (const entry of healingHistory) {
      await db.update(workflowNodes).set({
        config: entry.newConfig,
      }).where(eq(workflowNodes.id, entry.nodeId));
    }
  });

  return json({ runId: run.id, status: 'running' }, { status: 201 });
};
