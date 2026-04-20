import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import {
  workflowNodes,
  workflowEdges,
  nodeExecutions,
  orchestratorChats,
} from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { findTerminalNodeIds, terminalReplyText } from '$lib/canvas/adapter';

/**
 * POST /api/workflows/:id/chat/respond
 * Body: { runId }
 *
 * Finds the terminal node's outputData for the given run, formats it as text,
 * and inserts it as an assistant message. Returns the new message.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const runId = typeof body.runId === 'string' ? body.runId : '';
  const chatNodeId = typeof body.chatNodeId === 'string' ? body.chatNodeId : null;
  if (!runId) return json({ error: 'runId required' }, { status: 400 });

  const nodes = await db
    .select()
    .from(workflowNodes)
    .where(eq(workflowNodes.workflowId, params.id));
  const edges = await db
    .select()
    .from(workflowEdges)
    .where(eq(workflowEdges.workflowId, params.id));

  const terminalIds = findTerminalNodeIds(
    nodes.map((n) => ({ id: n.id })),
    edges.map((e) => ({ from: e.sourceNodeId, to: e.targetNodeId })),
  );
  if (terminalIds.length === 0) {
    return json({ error: 'No terminal node — nothing to reply with' }, { status: 400 });
  }

  // Prefer the first terminal node that has an output for this run
  let chosenNodeId: string | null = null;
  let chosenOutput: unknown = null;
  for (const nid of terminalIds) {
    const [ex] = await db
      .select()
      .from(nodeExecutions)
      .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.nodeId, nid)));
    if (ex && ex.outputData !== null && ex.outputData !== undefined) {
      chosenNodeId = nid;
      chosenOutput = ex.outputData;
      break;
    }
  }

  if (chosenNodeId === null) {
    // No terminal output — still post a placeholder so the user sees the run
    // actually produced nothing, rather than an empty UI state.
    const [assistant] = await db
      .insert(orchestratorChats)
      .values({
        workflowId: params.id,
        role: 'assistant',
        content: '(run finished with no terminal output)',
        metadata: { runId, nodeId: null, chatNodeId },
      })
      .returning();
    return json({ message: assistant });
  }

  const content = terminalReplyText(chosenOutput).trim() || '(empty output)';

  const [assistant] = await db
    .insert(orchestratorChats)
    .values({
      workflowId: params.id,
      role: 'assistant',
      content,
      metadata: { runId, nodeId: chosenNodeId, chatNodeId },
    })
    .returning();

  return json({ message: assistant });
};
