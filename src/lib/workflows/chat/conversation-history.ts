import { db } from '$lib/db';
import { orchestratorChats, conversations, jkaiAttachments } from '$lib/db/schema';
import { eq, asc, or } from 'drizzle-orm';
import { getChatHistory } from '$lib/workflows/orchestrator';
import type { JkaiAttachment } from '$lib/db/schema';

export interface HistoryMessage {
  role: string;
  content: string;
  attachments: JkaiAttachment[];
  createdAt: Date;
}

const MAX_HISTORY = 30;

async function loadAttachmentsFor(messageIds: string[]): Promise<Map<string, JkaiAttachment[]>> {
  const byMsg = new Map<string, JkaiAttachment[]>();
  if (messageIds.length === 0) return byMsg;
  const atts = await db
    .select()
    .from(jkaiAttachments)
    .where(or(...messageIds.map((id) => eq(jkaiAttachments.messageId, id)))!);
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
    const convMessages = await db
      .select({
        id: orchestratorChats.id,
        role: orchestratorChats.role,
        content: orchestratorChats.content,
        createdAt: orchestratorChats.createdAt,
      })
      .from(orchestratorChats)
      .where(eq(orchestratorChats.conversationId, conversationId))
      .orderBy(asc(orchestratorChats.createdAt));

    // All messages (including migrated WhatsApp) are now in orchestrator_chats
    const trimmed = convMessages.slice(-MAX_HISTORY);
    const ids = trimmed.map((m) => m.id);
    const byMsg = await loadAttachmentsFor(ids);
    return trimmed.map((m) => ({
      role: m.role,
      content: m.content,
      attachments: byMsg.get(m.id) ?? [],
      createdAt: m.createdAt,
    }));
  }

  if (workflowId) {
    const history = await getChatHistory(workflowId);
    const trimmed = history.slice(-MAX_HISTORY);
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
