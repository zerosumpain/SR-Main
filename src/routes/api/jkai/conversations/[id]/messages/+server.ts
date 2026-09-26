import { isHttpError, json } from '@sveltejs/kit';
import { requireConversation } from '$lib/jkai/chat-access.server';
import { CHAT_HISTORY_PAGE_SIZE, getConversationMessages } from '$lib/jkai/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const { params, url } = event;
  const beforeRaw = url.searchParams.get('before');
  const beforeId = url.searchParams.get('beforeId');
  const before = beforeRaw ? new Date(beforeRaw) : null;
  if ((beforeRaw || beforeId) && (!before || Number.isNaN(before.getTime()) || !beforeId)) {
    return json({ error: 'Invalid message cursor' }, { status: 400 });
  }

  // A thread the reader may not see is a 404, exactly like one that does not exist.
  let conversation;
  try {
    ({ conversation } = await requireConversation(event, params.id, 'read'));
  } catch (err) {
    if (isHttpError(err) && err.status === 404) return json({ error: 'Conversation not found' }, { status: 404 });
    throw err;
  }

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
