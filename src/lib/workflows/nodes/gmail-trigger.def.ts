import type { NodeDefinition } from '../types';

export const gmailTriggerDef: NodeDefinition = {
  type: 'gmail-trigger',
  category: 'trigger',
  label: 'Gmail Trigger',
  description: 'Fires when a new Gmail message matches a watched query',
  defaultConfig: { accountId: 0, watchId: null },
  inputs: [],
  outputs: [{ name: 'output', type: 'object', label: 'Event fields' }],
  configSchema: {
    type: 'object',
    properties: {
      accountId: { type: 'number', description: 'gmail_accounts row id' },
      watchId: { type: 'number', description: 'gmail_watches row id (optional — if unset, fires on any watch for the account)' },
    },
    required: ['accountId'],
  },
  basicConfig: [],
};
