import { db } from '$lib/db';
import { blogAssistantMessages } from '$lib/db/schema';
import { asc, eq } from 'drizzle-orm';

export type ChatRole = 'user' | 'assistant' | 'tool';

export type ChatMessage = {
  id: number;
  role: ChatRole;
  content: string;
  createdAt: Date;
};

export async function appendMessage(postId: number, role: ChatRole, content: string): Promise<void> {
  await db.insert(blogAssistantMessages).values({ postId, role, content });
}

export async function loadHistory(postId: number, limit = 20): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(blogAssistantMessages)
    .where(eq(blogAssistantMessages.postId, postId))
    .orderBy(asc(blogAssistantMessages.createdAt));
  // Take the LAST `limit` items (oldest at the front of the trimmed list).
  return rows.slice(-limit).map((r) => ({
    id: r.id,
    role: r.role as ChatRole,
    content: r.content,
    createdAt: r.createdAt,
  }));
}

export async function clearHistory(postId: number): Promise<void> {
  await db.delete(blogAssistantMessages).where(eq(blogAssistantMessages.postId, postId));
}
