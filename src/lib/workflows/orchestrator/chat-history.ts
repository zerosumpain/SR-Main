import { db } from '$lib/db';
import { orchestratorChats } from '$lib/db/schema';
import { asc, eq } from 'drizzle-orm';
import type { ChatMessage } from './types';

/**
 * Read a canvas workflow's chat history.
 *
 * Fourteen lines of SELECT, and it used to live in `orchestrator/index.ts`. That
 * file opens with `import { registry, engine } from '../index'` — the barrel
 * that registers every workflow node — so importing this one function cost 449
 * files. `chat/conversation-history.ts` imports exactly this and nothing else
 * from the orchestrator, which put the whole node registry inside the chat
 * endpoint's import closure.
 *
 * Same shape as the split that moved the publish half of the platform event bus
 * out of the workflows barrel during the Health extraction: a cheap thing
 * joined to an expensive one pays the expensive price, and the fix is to
 * separate them rather than to make the expensive one cheaper.
 */
export async function getChatHistory(workflowId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(orchestratorChats)
    .where(eq(orchestratorChats.workflowId, workflowId))
    .orderBy(asc(orchestratorChats.createdAt));

  return rows.map((r) => ({
    id: r.id,
    role: r.role as ChatMessage['role'],
    content: r.content,
    metadata: r.metadata as ChatMessage['metadata'],
    createdAt: r.createdAt.toISOString(),
  }));
}
