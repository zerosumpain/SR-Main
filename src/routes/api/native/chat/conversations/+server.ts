import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { clampLimit, withDevice } from '$lib/server/native-handler';
import { getConversationList, searchConversationList } from '$lib/jkai/queries';

/**
 * GET /api/native/chat/conversations — the thread list, and its search.
 *
 * `CONVERSATION_CARD` is already trimmed in SQL — `lastMessage` is clipped to
 * 200 characters there because the rail was shipping 102 kB of message bodies
 * to draw a 44-character line — so this projection drops only what a phone has
 * no surface for: the share token and visibility, the WhatsApp number, and cost.
 *
 * Cost is the interesting omission. It is on the web card because the desk has
 * a spend view to reconcile it against; on a phone it would be a number with no
 * frame, which is the failure mode /health names for a header figure.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  const limit = clampLimit(url.searchParams.get('limit'), 40, 200);

  // A search reaches the whole archive and answers in one un-paged set — a
  // cursor describes a position in the recency ordering, which the relevance
  // ordering does not share. Same short-circuit as the web endpoint.
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q) {
    const found = await searchConversationList({ q, limit });
    return { conversations: found.items.map(card), cursor: null, hasMore: false, query: q };
  }

  const beforeRaw = url.searchParams.get('before');
  const beforeId = url.searchParams.get('beforeId');
  const pinnedRaw = url.searchParams.get('beforePinned');
  const before = beforeRaw ? new Date(beforeRaw) : null;
  const cursorRequested = beforeRaw !== null || beforeId !== null || pinnedRaw !== null;
  if (
    cursorRequested &&
    (!before ||
      Number.isNaN(before.getTime()) ||
      !beforeId ||
      (pinnedRaw !== '0' && pinnedRaw !== '1'))
  ) {
    return json({ error: 'Invalid conversation cursor' }, { status: 400 });
  }

  const page = await getConversationList({
    limit,
    cursor:
      before && beforeId && pinnedRaw
        ? { before, beforeId, pinned: pinnedRaw === '1' }
        : undefined,
  });

  return {
    conversations: page.items.map(card),
    cursor: page.cursor,
    hasMore: page.hasMore,
  };
});

type ConversationRow = Awaited<ReturnType<typeof getConversationList>>['items'][number];

/** One row of the ledger. Dates go out as ISO 8601; the app decodes nothing else. */
function card(row: ConversationRow) {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    pinned: row.pinned,
    messageCount: row.messageCount,
    modelProvider: row.modelProvider,
    modelId: row.modelId,
    /** Already clipped to 200 characters in SQL. */
    preview: row.lastMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
