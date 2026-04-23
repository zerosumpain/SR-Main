import type { NodeDefinition } from '../types';

export const gmailFetchDef: NodeDefinition = {
  type: 'gmail-fetch',
  category: 'integration',
  label: 'Gmail — Fetch Message',
  description: 'Fetch a Gmail message by id, returning full headers + text/html bodies + attachment refs.',
  defaultConfig: { messageId: '{{input.messageId}}', accountId: 0 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'GmailMessage' }],
  configSchema: {
    type: 'object',
    required: ['messageId'],
    properties: {
      messageId: { type: 'string', description: 'Gmail message id (supports {{input.x}})' },
      accountId: { type: 'number', description: 'Account to fetch from. Falls back to input.accountId if 0.' },
    },
  },
  llmDescription: 'Fetches the full content of a Gmail message by id, including headers, plain-text body, HTML body, and attachment metadata. Place this immediately after gmail-trigger or gmail-search when you need more than the snippet. The trigger only provides a short preview — use gmail-fetch to get the complete body for LLM processing or forwarding. Output shape: { messageId, threadId, subject, from, to, date, bodyText, bodyHtml, attachments: [{ filename, mimeType, size }], labels }. Set accountId=0 to auto-inherit from the upstream trigger output.',
  llmExamples: [
    { messageId: '{{trigger.output.messageId}}', accountId: 0 },
    { messageId: '{{input.messageId}}', accountId: 1 },
    {
      messageId: '{{nodes.search.output.messages[0].id}}',
      accountId: 1,
    },
  ],
  basicConfig: [
    {
      key: 'messageId',
      label: 'Message ID',
      type: 'template-textarea',
      placeholder: '{{trigger.output.messageId}}',
      description: 'Gmail message id to fetch. Typically passed from gmail-trigger or gmail-search output.',
    },
    {
      key: 'accountId',
      label: 'Gmail Account',
      type: 'number',
      description: 'Account to fetch from. Use 0 to inherit from upstream trigger output (recommended).',
    },
  ],
};
