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
};
