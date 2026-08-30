// `recall` toolset — look things up in past conversations and in stored memory.
//
// The two verbs this replaces are low-volume (session_search 4 calls,
// memory 9 in 30 days) but they are the ones that make a long-running assistant
// feel continuous rather than amnesiac.
//
// Memory itself already exists in-repo and is arguably better than the old
// equivalent: `memory-review.ts` extracts facts from idle conversations into
// `jkai_memories` automatically, and `memorySection` injects them into every
// system prompt. What was missing is the ability to interrogate that on demand,
// and to search what was actually SAID rather than what was remembered.
import { register } from '../registry-internal';
import { db } from '$lib/db';
import { orchestratorChats, conversations, jkaiMemories } from '$lib/db/schema';
import { and, desc, eq, ilike, isNull, sql } from 'drizzle-orm';

register({
  name: 'session_search',
  description:
    'Search what was actually said in past conversations, by keyword. Returns matching messages with their conversation title and date. Use when the user refers to something discussed before ("what did we decide about X") and it is not in the current thread.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords to look for in message text.' },
      limit: { type: 'number', description: 'Max messages to return (default 15, max 50).' },
      role: { type: 'string', description: "Optional: 'user' or 'assistant' to search only one side." },
    },
    required: ['query'],
  },
  category: 'Recall',
  toolset: 'recall',
  handler: async (raw: Record<string, unknown>) => {
    const args = (raw ?? {}) as { query?: string; limit?: number; role?: string };
    const q = (args.query ?? '').trim();
    if (q.length < 2) return { success: false, error: 'query must be at least 2 characters' };
    const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50);
    try {
      const where = [ilike(orchestratorChats.content, `%${q}%`)];
      if (args.role === 'user' || args.role === 'assistant') {
        where.push(eq(orchestratorChats.role, args.role));
      }
      const rows = await db
        .select({
          content: orchestratorChats.content,
          role: orchestratorChats.role,
          createdAt: orchestratorChats.createdAt,
          conversationId: orchestratorChats.conversationId,
          title: conversations.title,
        })
        .from(orchestratorChats)
        .leftJoin(conversations, eq(conversations.id, orchestratorChats.conversationId))
        .where(and(...where))
        .orderBy(desc(orchestratorChats.createdAt))
        .limit(limit);

      return {
        success: true,
        data: {
          count: rows.length,
          matches: rows.map((r) => ({
            role: r.role,
            when: r.createdAt?.toISOString() ?? null,
            conversation: r.title ?? r.conversationId ?? null,
            // Enough to judge relevance without dumping whole turns into context.
            excerpt: excerpt(r.content ?? '', q),
          })),
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'session_search failed' };
    }
  },
});

register({
  name: 'memory_search',
  description:
    'Search stored long-term memories about the user — people, preferences, places, health, devices, situations. These are extracted automatically from past conversations. Use before asking the user something they may already have told you.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords. Omit to list the most recent memories.' },
      category: { type: 'string', description: 'Optional category filter.' },
      limit: { type: 'number', description: 'Max results (default 20, max 100).' },
    },
  },
  category: 'Recall',
  toolset: 'recall',
  handler: async (raw: Record<string, unknown>) => {
    const args = (raw ?? {}) as { query?: string; category?: string; limit?: number };
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
    try {
      // Superseded memories are history, not current belief — never return them.
      const where = [isNull(jkaiMemories.supersededBy)];
      const q = (args.query ?? '').trim();
      if (q) where.push(ilike(jkaiMemories.content, `%${q}%`));
      if (args.category) where.push(eq(jkaiMemories.category, args.category));

      const rows = await db
        .select()
        .from(jkaiMemories)
        .where(and(...where))
        .orderBy(desc(jkaiMemories.updatedAt))
        .limit(limit);

      return {
        success: true,
        data: {
          count: rows.length,
          memories: rows.map((m) => ({
            // The id was omitted, which made a returned memory impossible to
            // cite: anything quoting one could name the text but not the row
            // it came from. Additive, so no existing caller changes.
            id: m.id,
            category: m.category,
            content: m.content,
            confidence: m.confidence,
            updated: m.updatedAt?.toISOString() ?? null,
          })),
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'memory_search failed' };
    }
  },
});

register({
  name: 'memory_remember',
  description:
    'Store a durable fact about the user that should survive this conversation. Only for things useful LATER — not task details, and never credentials or financial data. Facts are also extracted automatically after a conversation goes idle, so use this for something explicitly worth pinning now.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The fact, stated plainly in one sentence.' },
      category: {
        type: 'string',
        description: 'people | preferences | places | health | devices | situations',
      },
    },
    required: ['content', 'category'],
  },
  category: 'Recall',
  toolset: 'recall',
  handler: async (raw: Record<string, unknown>) => {
    const args = (raw ?? {}) as { content?: string; category?: string };
    const content = (args.content ?? '').trim();
    const category = (args.category ?? '').trim();
    if (!content) return { success: false, error: 'content is required' };
    if (!category) return { success: false, error: 'category is required' };
    try {
      // Cheap duplicate guard: the automatic extractor also writes here, and two
      // routes into one table is exactly how a memory list fills with near-copies.
      const existing = await db
        .select({ id: jkaiMemories.id })
        .from(jkaiMemories)
        .where(and(isNull(jkaiMemories.supersededBy), sql`lower(${jkaiMemories.content}) = lower(${content})`))
        .limit(1);
      if (existing.length > 0) {
        return { success: true, data: { stored: false, reason: 'already remembered', content } };
      }
      await db.insert(jkaiMemories).values({ category, content, confidence: 'high' });
      return { success: true, data: { stored: true, category, content } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'memory_remember failed' };
    }
  },
});

/** A window around the first match, so relevance is judgeable without the whole turn. */
function excerpt(text: string, q: string, radius = 160): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + q.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
