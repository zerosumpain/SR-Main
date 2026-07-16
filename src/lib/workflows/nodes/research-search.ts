import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { searchResearch } from '$lib/deepdive/research-search';

export { researchSearchDef } from './research-search.def';

export const researchSearchExecutor: NodeExecutor = {
  type: 'research-search',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const query = interpolateTemplate(String(config.query ?? ''), input).trim();
    if (!query) {
      throw new Error('research-search: query is required (supports {{input.field}} templates)');
    }

    const topKRaw = Number(config.topK);
    const topK = Number.isFinite(topKRaw) ? Math.min(Math.max(Math.floor(topKRaw), 1), 30) : 8;

    const hits = await searchResearch(query, { topK });

    const results = hits.map((h) => ({
      kind: h.kind,
      snippet: h.passage,
      score: h.score,
      sessionId: h.sessionId,
      sessionTopic: h.sessionTopic,
      sourceTitle: h.sourceTitle,
      sourceUrl: h.sourceUrl,
      domain: h.domain,
    }));

    return {
      output: { query, results, count: results.length },
      rowCount: results.length,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for {{input.*}} interpolation in the query' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The executed search query' },
        results: {
          type: 'array',
          description: 'Ranked passages: { kind, snippet, score, sessionId, sessionTopic, sourceTitle, sourceUrl, domain }',
        },
        count: { type: 'number', description: 'Number of passages returned' },
      },
    };
  },
};
