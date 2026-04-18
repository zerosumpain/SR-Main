import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { search } from '$lib/deepdive/tavily';

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

export const tavilySearchDef: NodeDefinition = {
  type: 'tavily-search',
  label: 'Tavily Search',
  category: 'integration',
  description: 'Search the web via Tavily. Returns ranked results with URL, title, content snippet, and optional AI-generated answer.',
  configSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query. Supports {{input.field}} templates.' },
      searchDepth: { type: 'string', description: 'Search depth: "basic" (fast, cheap) or "advanced" (deeper, slower)' },
      maxResults: { type: 'number', description: 'Max results 1–20 (default 5)' },
      includeAnswer: { type: 'boolean', description: 'Include a Tavily-generated summary answer (default false)' },
    },
    required: ['query'],
  },
  defaultConfig: { query: '', searchDepth: 'basic', maxResults: 5, includeAnswer: false },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Search results' }],
  basicConfig: [
    { key: 'query', label: 'Query', type: 'template-textarea', placeholder: 'svelte 5 runes best practices' },
    { key: 'searchDepth', label: 'Depth', type: 'dropdown', options: [
      { value: 'basic', label: 'Basic (fast)' }, { value: 'advanced', label: 'Advanced (deeper)' },
    ]},
    { key: 'maxResults', label: 'Max results', type: 'number' },
    { key: 'includeAnswer', label: 'Include AI answer', type: 'toggle', advancedOnly: true },
  ],
  llmDescription: 'Searches the web via Tavily. Returns { query, answer?, results: [{ title, url, content, score }], count }. Use this to find relevant URLs and snippets for a topic. Pair with web-scrape to read the full text of promising results. Each result has a short `content` snippet — for full article text, follow up with web-scrape on the URL. Set includeAnswer=true to also get a Tavily-generated summary answer.',
  llmExamples: [
    { query: 'latest SvelteKit 2 changes', searchDepth: 'basic', maxResults: 5 },
    { query: '{{input.topic}}', searchDepth: 'advanced', maxResults: 10, includeAnswer: true },
  ],
};
