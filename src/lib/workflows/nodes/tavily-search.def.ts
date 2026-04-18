import type { NodeDefinition } from '../types';

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
    {
      key: 'query', label: 'Search Query', type: 'template-textarea',
      placeholder: 'svelte 5 runes best practices',
      description: 'What to search for. Supports {{input.field}} templates.',
    },
    {
      key: 'searchDepth', label: 'Search Depth', type: 'dropdown',
      description: 'Trade-off between speed/cost and result quality',
      options: [
        { value: 'basic', label: 'Basic (fast, cheap)' },
        { value: 'advanced', label: 'Advanced (deeper, slower)' },
      ],
    },
    {
      key: 'maxResults', label: 'Max Results', type: 'slider',
      min: 1, max: 20, step: 1,
      description: 'Number of results to return (1–20).',
    },
    {
      key: 'includeAnswer', label: 'Include AI Summary Answer', type: 'toggle',
      description: 'Return a Tavily-generated summary alongside the results.',
    },
  ],
  llmDescription: 'Searches the web via Tavily. Returns { query, answer?, results: [{ title, url, content, score }], count }. Use this to find relevant URLs and snippets for a topic. Pair with web-scrape to read the full text of promising results. Each result has a short `content` snippet — for full article text, follow up with web-scrape on the URL. Set includeAnswer=true to also get a Tavily-generated summary answer.',
  llmExamples: [
    { query: 'latest SvelteKit 2 changes', searchDepth: 'basic', maxResults: 5 },
    { query: '{{input.topic}}', searchDepth: 'advanced', maxResults: 10, includeAnswer: true },
  ],
};
