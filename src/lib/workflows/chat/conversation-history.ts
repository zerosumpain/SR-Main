import { db } from '$lib/db';
import { orchestratorChats, conversations, whatsappConversations, jkaiAttachments } from '$lib/db/schema';
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

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (conv?.whatsappPhoneNumber) {
      const waMessages = await db
        .select({
          role: whatsappConversations.role,
          content: whatsappConversations.content,
          createdAt: whatsappConversations.createdAt,
        })
        .from(whatsappConversations)
        .where(eq(whatsappConversations.phoneNumber, conv.whatsappPhoneNumber))
        .orderBy(asc(whatsappConversations.createdAt));

      const merged = [
        ...waMessages.map((m) => ({
          id: null as string | null,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          ts: m.createdAt.getTime(),
        })),
        ...convMessages.map((m) => ({
          id: m.id as string | null,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          ts: m.createdAt.getTime(),
        })),
      ].sort((a, b) => a.ts - b.ts);

      const trimmed = merged.slice(-MAX_HISTORY);
      const ids = trimmed.map((m) => m.id).filter((x): x is string => typeof x === 'string');
      const byMsg = await loadAttachmentsFor(ids);
      return trimmed.map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.id ? byMsg.get(m.id) ?? [] : [],
        createdAt: m.createdAt,
      }));
    }

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
