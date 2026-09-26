import { loadDailyAlerts } from '$lib/jkai/intel/daily-alerts.server';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';
import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { getConversationList } from '$lib/jkai/queries';
import {
  resolveDefaultModel,
  resolveChatAltOpenRouterModel,
  getApprovalUiSettings,
  DEFAULT_APPROVAL_UI,
} from '$lib/server/models/settings';
import { getCollectionBySlug, queryRecords } from '$lib/datastore';
import { BRIEFINGS_COLLECTION } from '$lib/constants/briefing';
import type { BriefingData } from '$lib/briefing/types';
import type { DailyAlertsSummary } from '$lib/constants/daily-alerts';
import { chatAccess, conversationListScope } from '$lib/jkai/chat-access.server';
import { viewerHolds, viewerOf } from '$lib/server/viewer';

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

export const load: PageServerLoad = async (event) => {
  const { url } = event;
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

  // A member's hub (access groups, jkai.chat): their own threads and nothing of
  // the owner's — no WhatsApp thread, no briefing, no model settings, and the
  // daily alerts only from their own intel space if they hold one.
  const access = await chatAccess(event);
  if (access.level !== 'owner') return memberHub(event, access, pendingQuestion, pendingSend);

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
      // The reader's digest, not the owner default.
      loadDailyAlerts(undefined, await resolveRequestScope(event)),
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
    member: false as const,
  };
};

const NO_ALERTS = (): DailyAlertsSummary => {
  const now = new Date().toISOString();
  return { status: 'empty', since: now, asOf: now, total: 0, high: 0, items: [] };
};

async function memberHub(
  event: Parameters<PageServerLoad>[0],
  access: Awaited<ReturnType<typeof chatAccess>>,
  pendingQuestion: string,
  pendingSend: boolean,
) {
  const viewer = await viewerOf(event);
  const [conversationPage, dailyAlerts] = await Promise.all([
    getConversationList({ scope: conversationListScope(access) }),
    viewerHolds(viewer, 'jkai.intel:self')
      ? loadDailyAlerts(undefined, await resolveRequestScope(event)).catch(NO_ALERTS)
      : Promise.resolve(NO_ALERTS()),
  ]);
  return {
    pendingQuestion,
    pendingSend,
    conversations: conversationPage.items,
    conversationsHasMore: conversationPage.hasMore,
    conversationCursor: conversationPage.cursor,
    whatsappThread: null,
    // The model is the site default, chosen server-side for every member turn;
    // the picker is hidden and the owner's settings are not sent.
    defaultChatModel: { provider: 'openrouter' as const, modelId: '' },
    chatAltOpenRouterModel: null,
    // The defaults, not the owner's tuned settings.
    approvalUi: { ...DEFAULT_APPROVAL_UI },
    freshBriefing: null,
    dailyAlerts,
    member: true as const,
  };
}
