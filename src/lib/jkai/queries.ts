import { db } from '$lib/db';
import { conversations, jkaiAttachments, jkaiBuilds, orchestratorChats } from '$lib/db/schema';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

/** How much of a thread's last message the rail carries. See the note on the
 *  `lastMessage` subquery below — the rail renders 44 characters of it. */
const LAST_MESSAGE_PREVIEW_CHARS = 200;

export const CONVERSATION_PAGE_SIZE = 80;

/**
 * The columns every thread-list surface renders, shared so the paged list and
 * the search below cannot drift apart — the library draws both with the same
 * card, so a column present in one and absent in the other is a blank field.
 */
const CONVERSATION_CARD = {
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
    select count(*)::int from orchestrator_chats
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
};

export async function getConversationList({
  limit = CONVERSATION_PAGE_SIZE,
  cursor,
}: {
  limit?: number;
  cursor?: { pinned: boolean; before: Date; beforeId: string };
} = {}) {
  const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const samePinBucket = cursor
    ? and(
        eq(conversations.pinned, cursor.pinned),
        or(
          lt(conversations.updatedAt, cursor.before),
          and(
            eq(conversations.updatedAt, cursor.before),
            lt(conversations.id, cursor.beforeId),
          ),
        ),
      )
    : undefined;
  // With descending booleans, unpinned rows follow every pinned row. Once the
  // cursor is already unpinned only older rows in that same bucket can follow.
  const cursorFilter = cursor?.pinned
    ? or(eq(conversations.pinned, false), samePinBucket)
    : samePinBucket;
  const rows = await db
    .select(CONVERSATION_CARD)
    .from(conversations)
    .where(cursorFilter)
    .orderBy(desc(conversations.pinned), desc(conversations.updatedAt), desc(conversations.id))
    .limit(boundedLimit + 1);

  const page = rows.slice(0, boundedLimit);
  const oldest = page[page.length - 1];

  return {
    items: page,
    hasMore: rows.length > boundedLimit,
    cursor: oldest
      ? {
          pinned: oldest.pinned,
          before: oldest.updatedAt.toISOString(),
          beforeId: oldest.id,
        }
      : null,
  };
}

/**
 * How many threads a search answers with. Search is "find the one I mean", not
 * a second way to page the archive — a scannable answer beats a complete one.
 */
const CONVERSATION_SEARCH_LIMIT = 60;

/**
 * The outer thread's id, spelled out in full.
 *
 * Drizzle renders `conversations.id` UNQUALIFIED inside a select-list fragment
 * (`"id"`), and a correlated subquery then resolves that against its OWN table:
 * `oc.conversation_id = "id"` silently becomes `oc.conversation_id = oc.id` and
 * matches nothing. In a WHERE clause the same expression renders qualified and
 * works, so the two halves of one query disagree with no error anywhere. Name
 * the column in full, the way `CONVERSATION_CARD` already does.
 */
const CONVERSATION_ID = sql.raw('"jkai_conversations"."id"');

/** Characters of message body returned around a content hit. */
const MATCH_EXCERPT_CHARS = 200;

/** The step array lives one level inside a trace's `steps` column, which holds
 *  the whole ToolTrace object. `jsonb_typeof` guards it because a row whose
 *  steps are not an array would make `jsonb_array_elements` throw for the WHOLE
 *  query rather than skip that row. */
const TOOL_STEPS = sql`jkai_tool_traces tt
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(tt.steps->'steps') = 'array' then tt.steps->'steps' else '[]'::jsonb end
      ) s`;

/**
 * Search every thread in the archive, not just the pages the library has loaded.
 *
 * Five surfaces are searched — title, message bodies, the capabilities a thread
 * actually invoked, its model and its source. The library's old filter ran in
 * the browser over the title and a 200-character preview of the last message,
 * on the pages already fetched, so "which thread did I use web_search in" had
 * no answer at all and anything older than the first page was invisible.
 *
 * Plain `ilike` rather than a tsvector: `orchestrator_chats` is a few MB, the
 * scan is sub-10 ms, and a substring match is what someone typing half a word
 * into a find box expects. `releases/console.ts` searches the same way.
 */
export async function searchConversationList({
  q,
  limit = CONVERSATION_SEARCH_LIMIT,
}: {
  q: string;
  limit?: number;
}) {
  const term = q.trim();
  // A single character matches most of the archive, which is not an answer.
  if (term.length < 2) return { items: [], hasMore: false, cursor: null };
  const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const like = `%${term}%`;
  const toolLabel = sql`coalesce(s->>'displayTool', s->>'tool')`;
  const toolHit = sql`(s->>'displayTool' ilike ${like} or s->>'tool' ilike ${like})`;

  const matchesTitle = sql<boolean>`coalesce(${conversations.title} ilike ${like}, false)`;
  const matchesModel = sql<boolean>`coalesce(${conversations.modelId} ilike ${like}, false)`;
  const matchesSource = sql<boolean>`coalesce(${conversations.source} ilike ${like}, false)`;
  const matchesMessage = sql<boolean>`exists (
    select 1 from orchestrator_chats oc
    where oc.conversation_id = ${CONVERSATION_ID} and oc.content ilike ${like}
  )`;
  const matchesTool = sql<boolean>`exists (
    select 1 from ${TOOL_STEPS}
    where tt.conversation_id = ${CONVERSATION_ID} and ${toolHit}
  )`;

  const rows = await db
    .select({
      ...CONVERSATION_CARD,
      matchesTitle: matchesTitle.as('matches_title'),
      matchesMessage: matchesMessage.as('matches_message'),
      matchesTool: matchesTool.as('matches_tool'),
      matchesModel: matchesModel.as('matches_model'),
      matchesSource: matchesSource.as('matches_source'),
      // Windowed in SQL for the same reason `lastMessage` is: the job is to
      // show WHY a thread matched, not to ship the turn it matched in.
      matchExcerpt: sql<string | null>`(
        select substring(
          oc.content
          from greatest(1, position(lower(${term}) in lower(oc.content)) - 70)
          for ${MATCH_EXCERPT_CHARS}
        )
        from orchestrator_chats oc
        where oc.conversation_id = ${CONVERSATION_ID} and oc.content ilike ${like}
        order by oc.created_at desc limit 1
      )`.as('match_excerpt'),
      matchedTools: sql<string[] | null>`(
        select array_agg(distinct ${toolLabel}) filter (where ${toolLabel} is not null)
        from ${TOOL_STEPS}
        where tt.conversation_id = ${CONVERSATION_ID} and ${toolHit}
      )`.as('matched_tools'),
    })
    .from(conversations)
    .where(or(matchesTitle, matchesModel, matchesSource, matchesMessage, matchesTool))
    // Title hits lead — they are what someone is usually reaching for — then
    // plain recency. Pinning deliberately does NOT lead here: a search is
    // already a deliberate pick, so promoting pins would bury the answer.
    .orderBy(desc(matchesTitle), desc(conversations.updatedAt), desc(conversations.id))
    .limit(boundedLimit);

  return {
    items: rows.map(({ matchesTitle: t, matchesMessage: m, matchesTool: tl, matchesModel: mo, matchesSource: s, matchedTools, ...row }) => ({
      ...row,
      matchedTools: matchedTools ?? [],
      // Ordered by how much it explains the hit: a card whose title plainly
      // contains the term needs no badge, one matched deep in a turn does.
      matchedIn: [t && 'title', m && 'message', tl && 'tool', mo && 'model', s && 'source']
        .filter((x): x is string => typeof x === 'string'),
    })),
    hasMore: false,
    cursor: null,
  };
}

export const CHAT_HISTORY_PAGE_SIZE = 100;

interface MessageCursor {
  before: Date;
  beforeId: string;
}

/**
 * Read one newest-first page and return it in transcript order. The cursor is
 * the oldest row delivered, so fetching the next page never retransmits the
 * complete lifetime of a long-running thread.
 */
export async function getConversationMessages(
  conversationId: string,
  {
    limit = CHAT_HISTORY_PAGE_SIZE,
    cursor,
  }: { limit?: number; cursor?: MessageCursor } = {},
) {
  const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const cursorFilter = cursor
    ? or(
        lt(orchestratorChats.createdAt, cursor.before),
        and(
          eq(orchestratorChats.createdAt, cursor.before),
          lt(orchestratorChats.id, cursor.beforeId),
        ),
      )
    : undefined;

  const rows = await db
    .select({
      id: orchestratorChats.id,
      role: orchestratorChats.role,
      content: orchestratorChats.content,
      metadata: orchestratorChats.metadata,
      createdAt: orchestratorChats.createdAt,
    })
    .from(orchestratorChats)
    .where(
      cursorFilter
        ? and(eq(orchestratorChats.conversationId, conversationId), cursorFilter)
        : eq(orchestratorChats.conversationId, conversationId),
    )
    .orderBy(desc(orchestratorChats.createdAt), desc(orchestratorChats.id))
    .limit(boundedLimit + 1);

  const page = rows.slice(0, boundedLimit);
  const messageIds = page.map((message) => message.id);
  const attachments = messageIds.length > 0
    ? await db.select().from(jkaiAttachments).where(inArray(jkaiAttachments.messageId, messageIds))
    : [];
  const attachmentsByMessage = new Map<string, typeof attachments>();
  for (const attachment of attachments) {
    if (!attachment.messageId) continue;
    const current = attachmentsByMessage.get(attachment.messageId) ?? [];
    current.push(attachment);
    attachmentsByMessage.set(attachment.messageId, current);
  }

  const oldest = page[page.length - 1];
  return {
    messages: page.reverse().map((message) => ({
      ...message,
      attachments: attachmentsByMessage.get(message.id) ?? [],
    })),
    hasOlder: rows.length > boundedLimit,
    cursor: oldest
      ? { before: oldest.createdAt.toISOString(), beforeId: oldest.id }
      : null,
  };
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
