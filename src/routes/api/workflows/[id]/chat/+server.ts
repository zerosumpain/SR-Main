import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import {
  workflows,
  workflowNodes,
  workflowEdges,
  workflowRuns,
  nodeExecutions,
  orchestratorChats,
} from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';

/**
 * POST /api/workflows/:id/chat
 *
 * 1. Inserts the user message
 * 2. Creates a workflow run with input.message = text
 * 3. Returns { runId, userMessageId } immediately; client subscribes to the
 *    existing SSE stream and calls /chat/respond once it completes.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'text required' }, { status: 400 });

  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });

  const [userMsg] = await db
    .insert(orchestratorChats)
    .values({ workflowId: params.id, role: 'user', content: text, metadata: {} })
    .returning();

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, params.id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, params.id));

  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowId: params.id,
      status: 'running',
      trigger: 'chat',
      startedAt: new Date(),
    })
    .returning();

  for (const node of nodes) {
    await db.insert(nodeExecutions).values({ runId: run.id, nodeId: node.id, status: 'pending' });
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

  engine
    .execute(definition, run.id, { message: text }, undefined, params.id, { selfHealing: true })
    .catch((err) => {
      console.error('[canvas/chat] workflow execution failed', err);
    });

  return json({ runId: run.id, userMessageId: userMsg.id });
};
