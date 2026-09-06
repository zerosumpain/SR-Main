import { loadDailyAlerts } from '$lib/jkai/intel/daily-alerts.server';
import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { getConversationList } from '$lib/jkai/queries';
import { resolveDefaultModel, resolveChatAltOpenRouterModel, getApprovalUiSettings } from '$lib/server/models/settings';
import { getCollectionBySlug, queryRecords } from '$lib/datastore';
import { BRIEFINGS_COLLECTION, type BriefingData } from '$lib/briefing/types';

/** How long a briefing counts as "today's" and is worth surfacing on the chat page. */
const BRIEFING_FRESH_MS = 20 * 60 * 60 * 1000;

/** Most recent WhatsApp messages carried into the page. The panel shows the
 *  recent end of the thread; the rest is a click away in the thread itself. */
const WHATSAPP_THREAD_LIMIT = 100;

/**
 * Latest complete briefing, if it is fresh. The digest used to be reachable
 * only from the command palette, so it went unread; the chat page is where the
 * day actually starts.
 */
async function loadFreshBriefing(): Promise<{ id: string; title: string; markdown: string; startedAt: string } | null> {
  try {
    if (!(await getCollectionBySlug(BRIEFINGS_COLLECTION))) return null;
    const { records } = await queryRecords(
      BRIEFINGS_COLLECTION,
      { sort: { field: 'createdAt', dir: 'desc' }, limit: 1 },
      'owner',
    );
    const b = records[0]?.data as unknown as BriefingData | undefined;
    if (!b || b.status !== 'complete' || !b.markdown) return null;
    if (Date.now() - new Date(b.startedAt).getTime() > BRIEFING_FRESH_MS) return null;
    return { id: b.id, title: b.title, markdown: b.markdown, startedAt: b.startedAt };
  } catch {
    return null;
  }
}

export const load: PageServerLoad = async ({ url }) => {
  /**
   * A question handed over from another surface — "Ask jkai about this" on a
   * research run. Read on the server so the composer is seeded when the page
   * first renders; reading it in `onMount` is too late, because the chat
   * component is constructed before the parent's mount hook runs.
   */
  const pendingQuestion = (url.searchParams.get('q') ?? '').trim().slice(0, 2000);
  /**
   * `send=1` means the caller asked a question rather than offering one to
   * finish, so it goes straight to the model. Only honoured alongside `q` —
   * on its own it would send an empty message.
   */
  const pendingSend = pendingQuestion.length > 0 && url.searchParams.get('send') === '1';

  // These four are independent of each other, so they go out together rather
  // than in series. The load previously awaited the conversation list, then the
  // WhatsApp lookup, then its messages, before it even reached the Promise.all
  // below — four sequential round-trips to build one page.
  const [conversationPage, [latestWaConv], defaultChatModel, chatAltOpenRouterModel, approvalUi, freshBriefing, dailyAlerts] =
    await Promise.all([
      getConversationList(),
      // Check for WhatsApp thread (now unified in jkai_conversations + orchestrator_chats)
      db
        .select({ id: conversations.id, phoneNumber: conversations.whatsappPhoneNumber })
        .from(conversations)
        .where(eq(conversations.source, 'whatsapp'))
        .orderBy(desc(conversations.updatedAt))
        .limit(1),
      resolveDefaultModel(),
      resolveChatAltOpenRouterModel(),
      getApprovalUiSettings(),
      loadFreshBriefing(),
      loadDailyAlerts(),
    ]);

  let whatsappThread: { id: string; phoneNumber: string; messages: any[] } | null = null;
  if (latestWaConv?.phoneNumber) {
    // Newest-first with a LIMIT, then reversed — the same shape the chat history
    // loader uses, and for the same reason. This had no LIMIT at all: every
    // message the WhatsApp thread had ever carried was selected in full and
    // serialised into the page payload on every single /jkai load, to render a
    // panel that only ever shows the recent end of the conversation.
    const waMessages = await db
      .select({
        id: orchestratorChats.id,
        role: orchestratorChats.role,
        content: orchestratorChats.content,
        createdAt: orchestratorChats.createdAt,
      })
      .from(orchestratorChats)
      .where(eq(orchestratorChats.conversationId, latestWaConv.id))
      .orderBy(desc(orchestratorChats.createdAt))
      .limit(WHATSAPP_THREAD_LIMIT);

    whatsappThread = {
      id: latestWaConv.id,
      phoneNumber: latestWaConv.phoneNumber,
      messages: waMessages.reverse(),
    };
  }

  // The four-window spend cycler and the run-count strip that used to live in
  // the sidebar footer are gone: today's spend against budget now sits in the
  // hub header (see +layout.server.ts), per-thread cost sits on each rail row
  // and in the graph rail's footer, and the full breakdown is a click away at
  // /admin/ops/costs. Computing all four windows on every /jkai load was three
  // aggregate queries nothing rendered.

  return {
    pendingQuestion,
    pendingSend,
    conversations: conversationPage.items,
    conversationsHasMore: conversationPage.hasMore,
    conversationCursor: conversationPage.cursor,
    whatsappThread,
    defaultChatModel,
    chatAltOpenRouterModel,
    approvalUi,
    freshBriefing,
    dailyAlerts,
  };
};
