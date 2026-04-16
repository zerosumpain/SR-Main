import { db } from '$lib/db';
import { orchestratorChats, conversations, whatsappConversations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getChatHistory } from '$lib/workflows/orchestrator';

export async function loadConversationHistory(
  conversationId?: string | null,
  workflowId?: string | null,
): Promise<Array<{ role: string; content: string }>> {
  if (conversationId) {
    const convMessages = await db
      .select({ role: orchestratorChats.role, content: orchestratorChats.content, createdAt: orchestratorChats.createdAt })
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
        .select({ role: whatsappConversations.role, content: whatsappConversations.content, createdAt: whatsappConversations.createdAt })
        .from(whatsappConversations)
        .where(eq(whatsappConversations.phoneNumber, conv.whatsappPhoneNumber))
        .orderBy(asc(whatsappConversations.createdAt));

      const merged = [
        ...waMessages.map(m => ({ role: m.role, content: m.content, ts: m.createdAt.getTime() })),
        ...convMessages.map(m => ({ role: m.role, content: m.content, ts: m.createdAt.getTime() })),
      ].sort((a, b) => a.ts - b.ts);

      return merged.slice(-30).map(m => ({ role: m.role, content: m.content }));
    }

    return convMessages.slice(-30).map(m => ({ role: m.role, content: m.content }));
  }

  if (workflowId) {
    const history = await getChatHistory(workflowId);
    return history.map(h => ({ role: h.role, content: h.content }));
  }

  return [];
}
