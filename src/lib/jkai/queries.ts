import { db } from '$lib/db';
import { conversations, jkaiBuilds, orchestratorChats } from '$lib/db/schema';
import { desc, sql } from 'drizzle-orm';

/** How much of a thread's last message the rail carries. See the note on the
 *  `lastMessage` subquery below — the rail renders 44 characters of it. */
const LAST_MESSAGE_PREVIEW_CHARS = 200;

export async function getConversationList() {
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      source: conversations.source,
      whatsappPhoneNumber: conversations.whatsappPhoneNumber,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      costUsd: conversations.costUsd,
      pinned: conversations.pinned,
      shareToken: conversations.shareToken,
      shareVisibility: conversations.shareVisibility,
      modelProvider: conversations.modelProvider,
      modelId: conversations.modelId,
      messageCount: sql<number>`(
        select count(*) from orchestrator_chats
        where orchestrator_chats.conversation_id = "jkai_conversations"."id"
      )`.as('message_count'),
      // Truncated in SQL, not in the component. Nothing renders more than the
      // first line clipped to 44 characters (`rowTitle`), but the rail was
      // shipping every last message in full: 102 kB of message bodies across
      // 483 threads, serialised into the page on every /jkai load, to draw a
      // few hundred characters of preview. 200 leaves the rail's client-side
      // search a useful haystack while taking the payload with it.
      lastMessage: sql<string>`(
        select left(content, ${sql.raw(String(LAST_MESSAGE_PREVIEW_CHARS))}) from orchestrator_chats
        where orchestrator_chats.conversation_id = "jkai_conversations"."id"
        order by created_at desc limit 1
      )`.as('last_message'),
    })
    .from(conversations)
    .orderBy(desc(conversations.pinned), desc(conversations.updatedAt));
}

/** How much of a build's prompt the list carries. The cards render
 *  `prompt.slice(0, 90)`; nothing in a list view reads more. */
const BUILD_PROMPT_PREVIEW_CHARS = 200;

/**
 * The columns a *list* of builds needs — the /jkai/builds page, the API the
 * page and the PWA sync read, and the canvas builder panel that polls it.
 *
 * This was `db.select()` — every column of every build ever made, with no
 * LIMIT, in both the page load and the API. Two-thirds of that payload is
 * three fields no list renders: the full prompt (68 kB across 90 builds, shown
 * clipped to 90 characters), `research_brief` (37 kB) and `chapter_plan`
 * (9.6 kB), which belong to the build detail view and only ever grow. The
 * builder panel polls this endpoint on a timer to find the one or two
 * non-terminal builds, so the whole lot went over the wire every few seconds.
 *
 * Detail views keep reading the full row by id — see `/api/jkai/builds/[id]`.
 */
export async function getBuildList() {
  return db
    .select({
      id: jkaiBuilds.id,
      title: jkaiBuilds.title,
      prompt: sql<string>`left(${jkaiBuilds.prompt}, ${sql.raw(String(BUILD_PROMPT_PREVIEW_CHARS))})`.as('prompt'),
      status: jkaiBuilds.status,
      outcome: jkaiBuilds.outcome,
      iterationsCompleted: jkaiBuilds.iterationsCompleted,
      tokensUsed: jkaiBuilds.tokensUsed,
      costUsd: jkaiBuilds.costUsd,
      budgetConfig: jkaiBuilds.budgetConfig,
      serveConfig: jkaiBuilds.serveConfig,
      publishedSlug: jkaiBuilds.publishedSlug,
      projectSlug: jkaiBuilds.projectSlug,
      planStatus: jkaiBuilds.planStatus,
      cardTitle: jkaiBuilds.cardTitle,
      cardBlurb: jkaiBuilds.cardBlurb,
      cardTag: jkaiBuilds.cardTag,
      origin: jkaiBuilds.origin,
      gitTargetConfig: jkaiBuilds.gitTargetConfig,
      modelProvider: jkaiBuilds.modelProvider,
      modelId: jkaiBuilds.modelId,
      conversationId: jkaiBuilds.conversationId,
      createdAt: jkaiBuilds.createdAt,
      updatedAt: jkaiBuilds.updatedAt,
      queuedAt: jkaiBuilds.queuedAt,
      heartbeatAt: jkaiBuilds.heartbeatAt,
    })
    .from(jkaiBuilds)
    .orderBy(desc(jkaiBuilds.createdAt));
}
