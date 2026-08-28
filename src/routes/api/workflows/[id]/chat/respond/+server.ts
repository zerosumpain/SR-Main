import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import {
  workflowNodes,
  workflowEdges,
  nodeExecutions,
  orchestratorChats,
  conversations,
} from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { findTerminalNodeIds, terminalReplyText } from '$lib/canvas/adapter';

/**
 * POST /api/workflows/:id/chat/respond
 * Body: { runId, chatNodeId }
 *
 * After a chat-triggered run completes, find the terminal node's
 * outputData, format it as text, and persist it as an assistant
 * message scoped to the chat node's conversation.
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

  // Resolve the chat node's conversation (so the assistant reply lands
  // in the right panel's history).
  let conversationId: string | null = null;
  if (chatNodeId) {
    const chatNode = nodes.find((n) => n.id === chatNodeId);
    const cfg = (chatNode?.config as Record<string, unknown>) || {};
    if (typeof cfg.conversationId === 'string') conversationId = cfg.conversationId;
  }

  // Prefer the chat node's OWN output when the caller named it. The chat
  // node returns the LLM's reply on `response` — that's
  // what the panel should persist, regardless of what downstream did with
  // the text (WhatsApp send, email, etc., would otherwise hijack the
  // panel with `{ success: true }` style payloads). Falls back to terminal
  // output for back-compat (single-node chats, headless triggers).
  let chosenNodeId: string | null = null;
  let chosenOutput: unknown = null;
  if (chatNodeId) {
    const [chatEx] = await db
      .select()
      .from(nodeExecutions)
      .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.nodeId, chatNodeId)));
    if (chatEx && chatEx.outputData !== null && chatEx.outputData !== undefined) {
      chosenNodeId = chatNodeId;
      chosenOutput = chatEx.outputData;
    }
  }

  if (chosenNodeId === null) {
    const terminalIds = findTerminalNodeIds(
      nodes.map((n) => ({ id: n.id })),
      edges.map((e) => ({ from: e.sourceNodeId, to: e.targetNodeId })),
    );
    if (terminalIds.length === 0) {
      return json({ error: 'No terminal node — nothing to reply with' }, { status: 400 });
    }
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
  }

  const assistantValues = {
    workflowId: params.id,
    conversationId,
    role: 'assistant' as const,
    content: '',
    metadata: { runId, nodeId: chosenNodeId, chatNodeId } as Record<string, unknown>,
  };

  if (chosenNodeId === null) {
    const [assistant] = await db
      .insert(orchestratorChats)
      .values({
        ...assistantValues,
        content: '(run finished with no terminal output)',
      })
      .returning();
    return json({ message: assistant });
  }

  const content = terminalReplyText(chosenOutput).trim() || '(empty output)';

  const [assistant] = await db
    .insert(orchestratorChats)
    .values({ ...assistantValues, content })
    .returning();

  // Bump the conversation's updatedAt and set a title if still blank.
  if (conversationId) {
    try {
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);
      if (conv) {
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (!conv.title) patch.title = content.slice(0, 50);
        await db.update(conversations).set(patch).where(eq(conversations.id, conversationId));
      }
    } catch {
      /* non-fatal */
    }
  }

  return json({ message: assistant });
};
