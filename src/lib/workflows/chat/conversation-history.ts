import { db } from '$lib/db';
import { orchestratorChats, conversations, jkaiAttachments } from '$lib/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';
import { getChatHistory } from '$lib/workflows/orchestrator';
import type { JkaiAttachment } from '$lib/db/schema';

export interface HistoryMessage {
  role: string;
  content: string;
  evidence?: unknown;
  attachments: JkaiAttachment[];
  createdAt: Date;
}

/**
 * How many messages to fetch. Not the same as how many are sent verbatim.
 *
 * There was no LIMIT here at all: every message in the conversation was
 * selected and then `.slice(-30)` threw all but the last 30 away in
 * JS. Two consequences, and the second is the bad one.
 *
 * The query walked the whole thread — harmless at 73 messages, and there is no
 * index on `conversation_id` to walk it with (see the btree declared in
 * `schema.ts`).
 *
 * And because the loader returned 30 while the caller asked `compressHistory`
 * to keep 30 recent, compression could never fire: message 31 and everything
 * behind it was discarded by that slice with no summary and nothing in the
 * reply to say it had gone. Fetching wider is what gives the compressor
 * something to compress.
 */
const HISTORY_FETCH_LIMIT = 200;

async function loadAttachmentsFor(messageIds: string[]): Promise<Map<string, JkaiAttachment[]>> {
  const byMsg = new Map<string, JkaiAttachment[]>();
  if (messageIds.length === 0) return byMsg;
  // `inArray`, not `or(...ids.map(eq))`. The window is 200 messages, so the OR
  // form handed Postgres a 200-branch boolean expression to plan on every single
  // chat turn; `= ANY($1)` is one parameter and one index probe.
  const atts = await db
    .select()
    .from(jkaiAttachments)
    .where(inArray(jkaiAttachments.messageId, messageIds));
  for (const a of atts) {
    if (!a.messageId) continue;
    const arr = byMsg.get(a.messageId) ?? [];
    arr.push(a);
    byMsg.set(a.messageId, arr);
  }
  return byMsg;
}

export async function loadConversationHistory(
  conversationId?: string | null,
  workflowId?: string | null,
): Promise<HistoryMessage[]> {
  if (conversationId) {
    // Newest-first with a LIMIT so the database returns the window, then
    // reversed here — `ORDER BY ... DESC LIMIT n` can use the index, whereas
    // ascending-then-slice has to produce the whole thread first.
    const newestFirst = await db
      .select({
        id: orchestratorChats.id,
        role: orchestratorChats.role,
        content: orchestratorChats.content,
        metadata: orchestratorChats.metadata,
        createdAt: orchestratorChats.createdAt,
      })
      .from(orchestratorChats)
      .where(eq(orchestratorChats.conversationId, conversationId))
      .orderBy(desc(orchestratorChats.createdAt))
      .limit(HISTORY_FETCH_LIMIT);

    // All messages (including migrated WhatsApp) are now in orchestrator_chats.
    // Returned oldest-first, and NOT trimmed to the verbatim window — `compressHistory`
    // owns that decision now, and trimming here is what silently ate the older
    // messages before it ever saw them.
    const trimmed = newestFirst.reverse();
    const ids = trimmed.map((m) => m.id);
    const byMsg = await loadAttachmentsFor(ids);
    return trimmed.map((m) => ({
      role: m.role,
      content: m.content,
      evidence: (m.metadata as { evidence?: unknown; toolSteps?: unknown } | null)?.toolSteps,
      attachments: byMsg.get(m.id) ?? [],
      createdAt: m.createdAt,
    }));
  }

  if (workflowId) {
    const history = await getChatHistory(workflowId);
    // Same window as the conversation branch, for the same reason: whatever
    // trims here is invisible to `compressHistory`.
    const trimmed = history.slice(-HISTORY_FETCH_LIMIT);
    const ids = trimmed.map((h) => h.id);
    const byMsg = await loadAttachmentsFor(ids);
    return trimmed.map((h) => ({
      role: h.role,
      content: h.content,
      attachments: byMsg.get(h.id) ?? [],
      createdAt: new Date(h.createdAt),
    }));
  }

  return [];
}
