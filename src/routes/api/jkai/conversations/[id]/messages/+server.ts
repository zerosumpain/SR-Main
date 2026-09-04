import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { CHAT_HISTORY_PAGE_SIZE, getConversationMessages } from '$lib/jkai/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
  const beforeRaw = url.searchParams.get('before');
  const beforeId = url.searchParams.get('beforeId');
  const before = beforeRaw ? new Date(beforeRaw) : null;
  if ((beforeRaw || beforeId) && (!before || Number.isNaN(before.getTime()) || !beforeId)) {
    return json({ error: 'Invalid message cursor' }, { status: 400 });
  }

  const [conversation] = await db
    .select({ source: conversations.source })
    .from(conversations)
    .where(eq(conversations.id, params.id))
    .limit(1);
  if (!conversation) return json({ error: 'Conversation not found' }, { status: 404 });

  const history = await getConversationMessages(params.id, {
    limit: CHAT_HISTORY_PAGE_SIZE,
    cursor: before && beforeId ? { before, beforeId } : undefined,
  });
  return json({
    ...history,
    messages: history.messages.map((message) => ({
      ...message,
      source: conversation.source === 'whatsapp' ? 'whatsapp' : 'web',
    })),
  });
};
