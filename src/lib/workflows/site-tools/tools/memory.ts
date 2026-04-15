// src/lib/workflows/site-tools/tools/memory.ts

import { register } from '../registry-internal';
import { db } from '$lib/db';
import { jkaiMemories } from '$lib/db/schema';
import { eq, and, isNull, ilike, desc } from 'drizzle-orm';

const CATEGORIES = ['people', 'preferences', 'places', 'health', 'devices', 'situations'] as const;

register({
  name: 'save_memory',
  description: 'Save a fact about the user to persistent memory. Use proactively when you learn something important (names, preferences, locations, health details). If this updates an existing memory, the old one is automatically superseded.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: CATEGORIES,
        description: 'Memory category',
      },
      content: {
        type: 'string',
        description: 'The fact to remember, in natural language (e.g. "John\'s mum lives in Whitley Bay")',
      },
    },
    required: ['category', 'content'],
  },
  category: 'Memory',
  toolset: 'memory',
  handler: async (args) => {
    const category = args.category as string;
    const content = args.content as string;

    // Check for existing memories in the same category that this might update
    const existing = await db.select()
      .from(jkaiMemories)
      .where(and(
        eq(jkaiMemories.category, category),
        isNull(jkaiMemories.supersededBy),
      ));

    // Simple keyword overlap check for deduplication
    const contentWords = content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const match = existing.find(m => {
      const memWords = m.content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const overlap = contentWords.filter(w => memWords.includes(w));
      return overlap.length >= Math.min(3, contentWords.length * 0.5);
    });

    const newId = crypto.randomUUID();

    if (match) {
      // Supersede the old memory
      await db.update(jkaiMemories)
        .set({ supersededBy: newId, updatedAt: new Date() })
        .where(eq(jkaiMemories.id, match.id));
    }

    await db.insert(jkaiMemories).values({
      id: newId,
      category,
      content,
      confidence: 'high',
    });

    return {
      success: true,
      data: {
        id: newId,
        category,
        content,
        superseded: match ? { id: match.id, content: match.content } : null,
      },
    };
  },
});

register({
  name: 'recall_memories',
  description: 'Search your memories about the user. Use when a question might benefit from past context. Can filter by query text and/or category.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search text (case-insensitive substring match)',
      },
      category: {
        type: 'string',
        enum: CATEGORIES,
        description: 'Filter by category',
      },
    },
  },
  category: 'Memory',
  toolset: 'memory',
  handler: async (args) => {
    const query = args.query as string | undefined;
    const category = args.category as string | undefined;

    const conditions = [isNull(jkaiMemories.supersededBy)];
    if (category) conditions.push(eq(jkaiMemories.category, category));
    if (query) conditions.push(ilike(jkaiMemories.content, `%${query}%`));

    const rows = await db.select()
      .from(jkaiMemories)
      .where(and(...conditions))
      .orderBy(desc(jkaiMemories.updatedAt))
      .limit(50);

    return { success: true, data: { memories: rows, count: rows.length } };
  },
});

register({
  name: 'forget_memory',
  description: 'Remove a memory. Use when the user says to forget something or when a memory is wrong.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Memory ID to forget',
      },
    },
    required: ['id'],
  },
  category: 'Memory',
  toolset: 'memory',
  handler: async (args) => {
    const id = args.id as string;
    const [memory] = await db.select()
      .from(jkaiMemories)
      .where(eq(jkaiMemories.id, id))
      .limit(1);

    if (!memory) return { success: false, error: 'Memory not found' };

    await db.update(jkaiMemories)
      .set({ supersededBy: 'forgotten', updatedAt: new Date() })
      .where(eq(jkaiMemories.id, id));

    return { success: true, data: { forgotten: memory.content } };
  },
});
