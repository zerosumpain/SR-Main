import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { desc, sql } from 'drizzle-orm';

export async function getConversationList() {
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      source: conversations.source,
      whatsappPhoneNumber: conversations.whatsappPhoneNumber,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      messageCount: sql<number>`(
        select count(*) from orchestrator_chats
        where orchestrator_chats.conversation_id = "jkai_conversations"."id"
      )`.as('message_count'),
      lastMessage: sql<string>`(
        select content from orchestrator_chats
        where orchestrator_chats.conversation_id = "jkai_conversations"."id"
        order by created_at desc limit 1
      )`.as('last_message'),
    })
    .from(conversations)
    .orderBy(desc(conversations.updatedAt));
}
