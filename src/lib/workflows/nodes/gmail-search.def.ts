import type { NodeDefinition } from '../types';

export const gmailSearchDef: NodeDefinition = {
  type: 'gmail-search',
  category: 'integration',
  label: 'Gmail — Search Messages',
  description: 'Search Gmail using a query string. Returns matching message ids, and optionally fetches full message content.',
  defaultConfig: {
    accountId: 0,
    query: '',
    maxResults: 50,
    fetchFullMessages: false,
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Search result' }],
  configSchema: {
    type: 'object',
    required: ['accountId', 'query'],
    properties: {
      accountId: { type: 'number', description: 'Gmail account row id' },
      query: { type: 'string', description: 'Gmail search query (supports {{input.x}})' },
      maxResults: { type: 'number', description: 'Maximum number of results to return (default 50)' },
      fetchFullMessages: {
        type: 'boolean',
        description: 'If true, fetches full message content for each result (slower)',
      },
    },
  },
};
