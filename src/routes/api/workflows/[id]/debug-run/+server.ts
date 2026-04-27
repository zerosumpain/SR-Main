import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';
import { isDisplayOnlyType } from '$lib/workflows/types';
import { randomUUID } from 'crypto';

interface CaptureEntry {
  nodeId: string;
  nodeType: string;
  capture: Record<string, unknown>;
}

/**
 * Run the workflow in dry-run mode (side-effecting nodes return
 * { simulated: true, would_send/would_publish/... } instead of executing).
 * Ephemeral — does not persist a workflow_runs row or node_executions rows.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const id = params.id;
  if (!id) {
    return json({ error: 'workflow id is required' }, { status: 400 });
  }

  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, id));
  if (!workflow) {
    return json({ error: 'Workflow not found' }, { status: 404 });
  }

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, id));

  const body = (await request.json().catch(() => ({}))) as { initialInput?: Record<string, unknown> };
  const initialInput = body.initialInput ?? {};

  const runnableNodes = nodes.filter((n) => !isDisplayOnlyType(n.type));
  const runnableEdges = edges.filter((e) => {
    const src = runnableNodes.find((n) => n.id === e.sourceNodeId);
    const tgt = runnableNodes.find((n) => n.id === e.targetNodeId);
    return src && tgt;
  });

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

  const runId = `dbg_${randomUUID()}`;
  const result = await engine.execute(definition, runId, initialInput, undefined, id, { dryRun: true });

  const captureLog: CaptureEntry[] = [];
  for (const [nodeId, output] of result.nodeOutputs.entries()) {
    if (output && typeof output === 'object' && (output as { simulated?: unknown }).simulated === true) {
      const nodeType = definition.nodes.find((n) => n.id === nodeId)?.type ?? 'unknown';
      captureLog.push({ nodeId, nodeType, capture: output as Record<string, unknown> });
    }
  }

  return json({
    runId,
    status: result.status,
    captureLog,
    nodeOutputs: Object.fromEntries(result.nodeOutputs),
    errors: Object.fromEntries(result.nodeErrors),
  });
};
