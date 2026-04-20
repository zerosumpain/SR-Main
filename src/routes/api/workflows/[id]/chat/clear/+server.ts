import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowNodes, orchestratorChats } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';

/**
 * POST /api/workflows/:id/chat/clear
 * Body: { chatNodeId }
 *
 * Deletes every chat message tied to the given chat node — both rows
 * stored under its conversationId AND legacy rows matched by
 * metadata.chatNodeId. The conversation row itself stays so the
 * pinned model / price snapshot survive.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const chatNodeId = typeof body.chatNodeId === 'string' ? body.chatNodeId : null;
  if (!chatNodeId) return json({ error: 'chatNodeId required' }, { status: 400 });

  const [node] = await db
    .select()
    .from(workflowNodes)
    .where(and(eq(workflowNodes.id, chatNodeId), eq(workflowNodes.workflowId, params.id)));
  if (!node || node.type !== 'chat') {
    return json({ error: 'Chat node not found for this workflow' }, { status: 404 });
  }

  const cfg = (node.config as Record<string, unknown>) || {};
  const conversationId =
    typeof cfg.conversationId === 'string' ? (cfg.conversationId as string) : null;

  let cleared = 0;

  if (conversationId) {
    const res = await db
      .delete(orchestratorChats)
      .where(eq(orchestratorChats.conversationId, conversationId))
      .returning({ id: orchestratorChats.id });
    cleared += res.length;
  }

  // Also sweep legacy rows for this chat node on this workflow.
  const res2 = await db
    .delete(orchestratorChats)
    .where(
      and(
        eq(orchestratorChats.workflowId, params.id),
        sql`${orchestratorChats.metadata}->>'chatNodeId' = ${chatNodeId}`,
      ),
    )
    .returning({ id: orchestratorChats.id });
  cleared += res2.length;

  return json({ cleared });
};
