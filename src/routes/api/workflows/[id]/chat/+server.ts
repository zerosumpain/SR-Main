import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import {
  workflows,
  workflowNodes,
  orchestratorChats,
  conversations,
} from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { startRun } from '$lib/workflows/start-run';
import { resolveChatTurnModel } from '$lib/server/models/workload-settings';

/**
 * POST /api/workflows/:id/chat
 *
 * 1. Resolves (or creates) a jkai_conversations row for the target
 *    chat node, storing its id in the node's config.conversationId.
 * 2. Inserts the user message (conversationId + metadata.chatNodeId).
 * 3. Kicks off a workflow run with initialInput that threads both ids
 *    into the chat executor.
 *
 * Client polls /runs/{runId}/stream (SSE) for progress and POSTs to
 * /chat/respond once the run completes to persist the assistant reply.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const requestedChatNodeId =
    typeof body.chatNodeId === 'string' ? (body.chatNodeId as string) : null;
  if (!text) return json({ error: 'text required' }, { status: 400 });

  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, params.id));

  // Pick the chat node (caller-specified, else first chat-type node).
  const chatNodeId =
    requestedChatNodeId ?? nodes.find((n) => n.type === 'chat')?.id ?? null;
  const chatNode = chatNodeId ? nodes.find((n) => n.id === chatNodeId) : null;
  if (!chatNode) {
    return json({ error: 'No chat node resolved for this workflow' }, { status: 400 });
  }

  // Ensure the chat node has a conversation. Each chat node gets its
  // own jkai_conversations row so history, pinned model, and usage
  // tracking are scoped per panel.
  const chatConfig = (chatNode.config as Record<string, unknown>) || {};
  let conversationId =
    typeof chatConfig.conversationId === 'string' ? (chatConfig.conversationId as string) : null;

  if (conversationId) {
    // Verify it still exists; otherwise drop and recreate.
    const [exists] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!exists) conversationId = null;
  }

  if (!conversationId) {
    // The `chat` workload, not the bare site default: a conversation stamps
    // this at creation and keeps it, so it is the row on /admin/ops/costs that
    // says what new threads open on.
    const defaultCtx = await resolveChatTurnModel();
    const [conv] = await db
      .insert(conversations)
      .values({
        title: text.slice(0, 50),
        source: 'web',
        modelProvider: defaultCtx.provider,
        modelId: defaultCtx.modelId,
      })
      .returning();
    conversationId = conv.id;

    await db
      .update(workflowNodes)
      .set({ config: { ...chatConfig, conversationId } })
      .where(
        and(eq(workflowNodes.id, chatNode.id), eq(workflowNodes.workflowId, params.id)),
      );
  }

  const [userMsg] = await db
    .insert(orchestratorChats)
    .values({
      conversationId,
      workflowId: params.id,
      role: 'user',
      content: text,
      metadata: { chatNodeId },
    })
    .returning();

  // The kernel loads the definition AFTER the conversation id was written to
  // the chat node, so the run sees it in config as well as in its input.
  const started = await startRun({
    workflowId: params.id,
    trigger: 'chat',
    input: { message: text, _chatNodeId: chatNodeId, _conversationId: conversationId },
    watchdog: true,
    label: 'canvas/chat',
  });
  if (!started) return json({ error: 'Workflow not found' }, { status: 404 });

  return json({
    runId: started.runId,
    userMessageId: userMsg.id,
    chatNodeId,
    conversationId,
  });
};
