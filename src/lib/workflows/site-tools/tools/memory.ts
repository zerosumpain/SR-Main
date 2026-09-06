import { writeMemory, forgetMemory } from '$lib/jkai/memory/service.server';
import { retrieveMemories } from '$lib/jkai/memory/retrieve.server';
// src/lib/workflows/site-tools/tools/memory.ts

import { register } from '../registry-internal';

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
      assertion: { type: 'string', enum: ['stated', 'inferred'], description: 'stated only for an explicit user statement; otherwise inferred (default).' },
      sourceMessageId: { type: 'string', description: 'Source user message or evidence identifier, when available.' },
      entityIds: { type: 'array', items: { type: 'string' }, description: 'Verified graph entity IDs this memory concerns.' },
      validFrom: { type: 'string', description: 'ISO date when this fact becomes true, if known.' },
      validUntil: { type: 'string', description: 'ISO expiry date for temporary situations.' },
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
      entityIds: args.entityIds as string[] | undefined, replacesId: args.replacesId as string | undefined, sourceConversationId: ctx?.conversationId,
      provenance: { validFrom: args.validFrom as string | undefined, validUntil: args.validUntil as string | undefined, origin: 'user', assertion: args.assertion === 'stated' ? 'stated' : 'inferred', sourceId: (args.sourceMessageId as string | undefined) ?? ctx?.conversationId },
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
        description: 'Natural-language recall using text, semantic similarity and connected entities',
      },
      asOf: { type: 'string', description: 'ISO date for historical recall; forgotten facts remain excluded.' },
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

    const retrieved = await retrieveMemories(query, category, 50, { asOf: args.asOf as string | undefined });
    // The 1,536-float embedding is retrieval's business, not the model's: it
    // would cost ~2.5KB of context per row and push a 16-row recall past the
    // trace's 40KB result cap, at which point the recorded step keeps no ids
    // at all and the thread inspector cannot say which memories were recalled.
    const rows = retrieved.map(({ embedding: _embedding, ...row }) => row);

    const { buildKnowledgeContext } = await import('$lib/jkai/intel/context');
    const intelligence = query ? await buildKnowledgeContext(query) : '';
    return { success: true, data: { memories: rows, count: rows.length, intelligence } };
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
