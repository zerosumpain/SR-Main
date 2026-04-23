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
  llmDescription: 'On-demand Gmail search using Gmail query syntax (e.g. "from:boss@corp.com subject:invoice newer_than:7d is:unread"). Use this node — not gmail-trigger — when you want to actively query the mailbox mid-workflow rather than reacting to incoming mail. Returns { messages: [{ id, threadId, subject, from, snippet }], count }. Set fetchFullMessages=true to include full body and attachments in each result (slower, avoid for large result sets). Pair with gmail-fetch downstream if you only need the full body for specific results. Query syntax reference: Gmail advanced search operators.',
  llmExamples: [
    {
      accountId: 1,
      query: 'from:invoices@supplier.com subject:invoice is:unread newer_than:30d',
      maxResults: 20,
      fetchFullMessages: false,
    },
    {
      accountId: 1,
      query: '{{input.searchQuery}}',
      maxResults: 10,
      fetchFullMessages: true,
    },
    {
      accountId: 1,
      query: 'label:action-required is:unread',
      maxResults: 50,
    },
  ],
  basicConfig: [
    {
      key: 'accountId',
      label: 'Gmail Account',
      type: 'number',
      description: 'The gmail_accounts row id to search in.',
    },
    {
      key: 'query',
      label: 'Search Query',
      type: 'template-textarea',
      placeholder: 'from:someone@example.com subject:report newer_than:7d',
      description: 'Gmail search query. Supports Gmail advanced search operators and {{input.x}} templates.',
    },
    {
      key: 'maxResults',
      label: 'Max Results',
      type: 'number',
      description: 'Maximum number of messages to return (default 50).',
    },
    {
      key: 'fetchFullMessages',
      label: 'Fetch Full Messages',
      type: 'toggle',
      description: 'If enabled, returns full body and attachments for each result. Slower for large sets.',
      section: 'ADVANCED',
      advancedOnly: true,
    },
  ],
};
