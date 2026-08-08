import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { jkaiToolTraces, orchestratorChats, conversations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ToolTrace } from '$lib/jkai/tool-trace';

// Owner-gated by hooks (the whole /jkai area is owner-only) — see
// hooks.server.ts, which redirects a non-owner before any load runs.

/**
 * The route param accepts either identifier a caller might hold:
 *
 *  - the **trace id** (= the chat job id), which is what the live chat has the
 *    moment a turn finishes, and what `metadata.traceId` stores; and
 *  - the assistant **message id**, which is the only stable id a reloaded
 *    thread has for a turn.
 *
 * Trying the primary key first keeps the common case to a single indexed
 * lookup.
 */
export const load: PageServerLoad = async ({ params }) => {
  const id = params.traceId;

  let [row] = await db.select().from(jkaiToolTraces).where(eq(jkaiToolTraces.id, id)).limit(1);
  if (!row) {
    [row] = await db.select().from(jkaiToolTraces).where(eq(jkaiToolTraces.messageId, id)).limit(1);
  }
  if (!row) throw error(404, 'No tool trace for that turn');

  // The reply this chain produced, for context at the top of the page. Absent
  // when the turn never persisted a message (cancelled, or a hang-up before the
  // insert) — the chain is still worth showing on its own.
  let reply: { id: string; content: string; createdAt: Date } | null = null;
  if (row.messageId) {
    const [msg] = await db
      .select({ id: orchestratorChats.id, content: orchestratorChats.content, createdAt: orchestratorChats.createdAt })
      .from(orchestratorChats)
      .where(eq(orchestratorChats.id, row.messageId))
      .limit(1);
    reply = msg ?? null;
  }

  let conversationTitle: string | null = null;
  if (row.conversationId) {
    const [conv] = await db
      .select({ title: conversations.title })
      .from(conversations)
      .where(eq(conversations.id, row.conversationId))
      .limit(1);
    conversationTitle = conv?.title ?? null;
  }

  return {
    trace: row.steps as ToolTrace,
    meta: {
      id: row.id,
      conversationId: row.conversationId,
      workflowId: row.workflowId,
      messageId: row.messageId,
      conversationTitle,
      prompt: row.prompt,
      model: row.model,
      provider: row.provider,
      costUsd: row.costUsd,
      stepCount: row.stepCount,
      errorCount: row.errorCount,
      durationMs: row.durationMs,
      createdAt: row.createdAt,
    },
    reply,
  };
};
