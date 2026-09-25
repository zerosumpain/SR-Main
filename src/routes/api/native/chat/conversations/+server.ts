import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { clampLimit, withDevice } from '$lib/server/native-handler';
import { getConversationList, searchConversationList } from '$lib/jkai/queries';
import { resolveDefaultThinkingLevel } from '$lib/server/models/settings';
import { resolveChatTurnModel } from '$lib/server/models/workload-settings';
import { isPlaceholderTitle } from '$lib/jkai/thread-title';
import { snapshotPrice } from '$lib/server/models/price-snapshot';

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

/**
 * POST /api/native/chat/conversations — start one.
 *
 * The phone had no way to begin a thread: every turn it could send had to go
 * into a conversation the website had already created, so the app's only entry
 * into chat was a thread somebody had started at the desk. A composer with
 * nothing to compose into is the shortest description of what was wrong with
 * the chat tab.
 *
 * No model picker in the body. The web endpoint takes one because the composer
 * has one; here the thread opens on the `chat` workload's model, which follows
 * the site default until pinned, and `modelPinnedByUser` is false to say that
 * choosing nothing is not a choice. Pinning a model from a phone would stamp a
 * price snapshot the person never saw.
 */
export const POST: RequestHandler = withDevice(async ({ request }) => {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // A bodiless POST is a perfectly good "start a thread". Only a malformed
    // one would land here, and defaulting is kinder than 400ing the + button.
  }
  const payload = (body ?? {}) as { title?: unknown };
  const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 200) : '';

  const ctx = await resolveChatTurnModel();
  const [conv] = await db
    .insert(conversations)
    .values({
      // The app opens every thread as "New thread". Stored, that read as a
      // name: the first reply never titled the thread, and /drive filed every
      // photo from the phone in one "New thread" folder. NULL is what the web
      // sends, and what the app already shows as "Untitled thread".
      title: isPlaceholderTitle(title) ? null : title,
      source: 'web',
      modelProvider: ctx.provider,
      modelId: ctx.modelId,
      modelPinnedByUser: false,
      thinkingLevel: await resolveDefaultThinkingLevel(),
      priceSnapshot: await snapshotPrice(ctx),
    })
    .returning();

  // The same projection the list uses, so the app can insert the row it gets
  // back straight into the ledger rather than re-fetching the whole page.
  return json(
    {
      id: conv.id,
      title: conv.title,
      source: conv.source,
      pinned: conv.pinned,
      messageCount: 0,
      modelProvider: conv.modelProvider,
      modelId: conv.modelId,
      preview: null,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
    },
    { status: 201 },
  );
});
