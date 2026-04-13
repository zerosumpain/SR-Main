import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';

export const POST: RequestHandler = async ({ params, request }) => {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!workflow) {
    return json({ error: 'Workflow not found' }, { status: 404 });
  }

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, params.id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, params.id));

  const body = await request.json().catch(() => ({}));
  const initialInput = body.input || {};

  const [run] = await db.insert(workflowRuns).values({
    workflowId: params.id,
    status: 'running',
    trigger: 'manual',
    startedAt: new Date(),
  }).returning();

  // Create pending node execution records
  for (const node of nodes) {
    await db.insert(nodeExecutions).values({
      runId: run.id,
      nodeId: node.id,
      status: 'pending',
    });
  }

  const definition: WorkflowDefinition = {
    id: workflow.id,
    name: workflow.name,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position as { x: number; y: number },
      config: (n.config || {}) as Record<string, unknown>,
      label: n.label,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };

  // Execute in background — don't await
  engine.execute(definition, run.id, initialInput).then(async (result) => {
    await db.update(workflowRuns).set({
      status: result.status,
      completedAt: new Date(),
      error: result.error || null,
    }).where(eq(workflowRuns.id, run.id));

    // Update node execution records
    for (const [nodeId, output] of result.nodeOutputs) {
      const inputData = result.nodeInputs.get(nodeId);
      await db.update(nodeExecutions).set({
        status: 'completed',
        inputData: inputData ?? null,
        outputData: output,
        completedAt: new Date(),
      }).where(
        eq(nodeExecutions.nodeId, nodeId),
      );
    }

    for (const [nodeId, error] of result.nodeErrors) {
      await db.update(nodeExecutions).set({
        status: 'failed',
        error,
        completedAt: new Date(),
      }).where(
        eq(nodeExecutions.nodeId, nodeId),
      );
    }
  });

  return json({ runId: run.id, status: 'running' }, { status: 201 });
};
