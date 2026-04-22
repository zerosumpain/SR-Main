import type { NodeDefinition } from '../types';

export const gmailLabelDef: NodeDefinition = {
  type: 'gmail-label',
  category: 'integration',
  label: 'Gmail — Modify Labels',
  description: 'Add or remove Gmail labels on a message. Common uses: archive (remove INBOX), mark read (remove UNREAD), star (add STARRED).',
  defaultConfig: {
    accountId: 0,
    messageId: '{{input.messageId}}',
    add: [],
    remove: [],
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Label result' }],
  configSchema: {
    type: 'object',
    required: ['accountId', 'messageId'],
    properties: {
      accountId: { type: 'number', description: 'Gmail account row id' },
      messageId: { type: 'string', description: 'Gmail message id (supports {{input.x}})' },
      add: {
        type: 'array',
        items: { type: 'string' },
        description: 'Label ids to add (e.g. ["STARRED"])',
      },
      remove: {
        type: 'array',
        items: { type: 'string' },
        description: 'Label ids to remove (e.g. ["INBOX", "UNREAD"])',
      },
    },
  },
};
