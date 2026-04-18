import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { search } from '$lib/deepdive/tavily';

export { tavilySearchDef } from './tavily-search.def';

export const tavilySearchExecutor: NodeExecutor = {
  type: 'tavily-search',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const rawQuery = (config.query as string) || '';
    const query = interpolateTemplate(rawQuery, input).trim();

    if (!query) {
      throw new Error('tavily-search: query is required (supports {{input.field}} templates)');
    }

    const searchDepth = (config.searchDepth as 'basic' | 'advanced') || 'basic';
    const maxResults = Math.min(Math.max(Number(config.maxResults) || 5, 1), 20);
    const includeAnswer = config.includeAnswer === true || config.includeAnswer === 'true';

    const response = await search(query, { maxResults, searchDepth, includeAnswer });

    return {
      output: {
        query,
        answer: response.answer ?? null,
        results: response.results.map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
          score: r.score,
        })),
        count: response.results.length,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for query template interpolation (e.g. {{input.topic}})' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The executed search query' },
        answer: { type: 'string', description: 'Tavily-generated summary answer (null unless includeAnswer=true)' },
        results: {
          type: 'array',
          description: 'Ranked search results',
        },
        count: { type: 'number', description: 'Number of results returned' },
      },
    };
  },
};

