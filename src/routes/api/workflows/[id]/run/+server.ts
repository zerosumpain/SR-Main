import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';
import { isDisplayOnlyType } from '$lib/workflows/types';
import { emitObs } from '$lib/workflows/observability-bus';
import { finaliseRun, failRun } from '$lib/workflows/run-finalise';

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
    // Persist initial input so the enqueue path (worker mode) can replay it;
    // the in-process path below passes initialInput directly and ignores this.
    inputData: initialInput,
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

  // #19 DISPATCH SWITCH (ADDITIVE, FEATURE-FLAGGED): when the durable run-worker
  // is enabled, ENQUEUE the run for the out-of-process worker instead of
  // executing it in-process here. The row is already inserted as 'running'
  // above; enqueue() flips it back to 'pending' + clears any lease so the
  // worker can claim it. When the flag is OFF this branch is skipped entirely
  // and the in-process execute() path below runs byte-for-byte as before.
  if (process.env.JKAI_RUN_WORKER === '1') {
    const { enqueue } = await import('$lib/workflows/run-queue');
    await enqueue(run.id);
    return json({ runId: run.id, status: 'pending' }, { status: 201 });
  }

  // Execute in background — don't await. The settled result is written by the
  // shared finaliser (run status, node rows, fix proposals, workflow_completed).
  engine
    .execute(definition, run.id, initialInput, breakpoints, params.id, { selfHealing })
    .then((result) => finaliseRun({ workflowId: params.id, runId: run.id, result, runStartedAt, label: 'run' }))
    .catch((err) => failRun({ workflowId: params.id, runId: run.id, error: err, label: 'run' }));

  return json({ runId: run.id, status: 'running' }, { status: 201 });
};
