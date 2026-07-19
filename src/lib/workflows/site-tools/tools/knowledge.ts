// `knowledge` toolset — one recall across everything JKai knows: /drive files,
// deep-dive research facts, personal memory, and datastore records. Wraps
// $lib/knowledge/search.searchKnowledge. Use for "what do I know about X" —
// broader than @files (files only) or @research (research only).
import { register } from '../registry-internal';
import { searchKnowledge, ALL_SOURCES, type KnowledgeSource } from '$lib/knowledge/search';

function coerceSources(raw: unknown): KnowledgeSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid = raw.filter((s): s is KnowledgeSource => ALL_SOURCES.includes(s as KnowledgeSource));
  return valid.length ? valid : undefined;
}

register({
  name: 'knowledge_search',
  description:
    'Unified recall across EVERYTHING JKai knows: /drive file contents, deep-dive research facts, saved personal memory, and datastore records — in one call. ' +
    'Use this whenever the user asks "what do I know / have I got anything about X", or when a question could be answered from any of your own stores and you are not sure which. ' +
    'Broader than file_search (files only) or research_search (research only). Returns ranked hits, each tagged with its source (files/research/memory/datastore), a passage, a relevance score, and a citation ref. ' +
    'When the user writes "@knowledge", use this tool.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to recall (natural language).' },
      sources: {
        type: 'array',
        items: { type: 'string', enum: ALL_SOURCES },
        description: 'Optional subset of stores to search: files, research, memory, datastore. Omit to search all.',
      },
      limitPerSource: { type: 'number', description: 'Max hits per store before merging (default 5, max 20).' },
      collections: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional datastore collection slugs to keyword-search. Omit to search every non-system collection.',
      },
    },
    required: ['query'],
  },
  category: 'Knowledge',
  toolset: 'knowledge',
  handler: async (args) => {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return { success: false, error: 'query is required' };
    try {
      const result = await searchKnowledge(query, {
        sources: coerceSources(args.sources),
        limitPerSource: args.limitPerSource !== undefined ? Number(args.limitPerSource) : undefined,
        datastoreCollections: Array.isArray(args.collections)
          ? (args.collections as unknown[]).filter((c): c is string => typeof c === 'string')
          : undefined,
      });
      return {
        success: true,
        data: {
          query: result.query,
          count: result.hits.length,
          counts: result.counts,
          hits: result.hits,
          errors: Object.keys(result.errors).length ? result.errors : undefined,
          note: result.hits.length === 0 ? 'Nothing matched across any knowledge store.' : undefined,
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'knowledge search failed' };
    }
  },
});
