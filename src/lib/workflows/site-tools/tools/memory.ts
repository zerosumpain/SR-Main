import { writeMemory, forgetMemory } from '$lib/jkai/memory/service.server';
import { retrieveMemories } from '$lib/jkai/memory/retrieve.server';
// src/lib/workflows/site-tools/tools/memory.ts

import { register } from '../registry-internal';
import { db } from '$lib/db';
import { jkaiMemories } from '$lib/db/schema';
import { eq, and, isNull, ilike, desc } from 'drizzle-orm';

const CATEGORIES = ['people', 'preferences', 'places', 'health', 'devices', 'situations', 'patterns'] as const;

register({
  name: 'save_memory',
  description: 'Save a fact about the user to persistent memory. Use proactively when you learn something important (names, preferences, locations, health details). If this updates an existing memory, supply its exact replacesId to supersede it. Independent facts are never merged by word overlap.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: CATEGORIES,
        description: 'Memory category',
      },
      replacesId: { type: 'string', description: 'Explicit current memory ID to replace; omit for an independent fact.' },
      content: {
        type: 'string',
        description: 'The fact to remember, in natural language (e.g. "John\'s mum lives in Whitley Bay")',
      },
    },
    required: ['category', 'content'],
  },
  category: 'Memory',
  toolset: 'memory',
  handler: async (args, ctx) => {
    const row = await writeMemory({ category: args.category as string, content: args.content as string,
      replacesId: args.replacesId as string | undefined, sourceConversationId: ctx?.conversationId,
      provenance: { origin: 'user', assertion: 'stated', sourceId: ctx?.conversationId },
    });
    return { success: true, data: { id: row.id, category: row.category, content: row.content, stored: row.stored } };
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

    const rows = await retrieveMemories(query, category, 50);

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
    const memory = await forgetMemory(id);

    return { success: true, data: { forgotten: memory.content } };
  },
});
