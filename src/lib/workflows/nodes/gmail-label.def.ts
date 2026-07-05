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
  llmDescription: 'Adds or removes Gmail system or custom labels on a message. Common patterns: archive (remove: ["INBOX"]), mark as read (remove: ["UNREAD"]), star (add: ["STARRED"]), tag with a custom label (add: ["Label_12345678"]). Custom label ids are not human-readable names — look them up via /admin/connections/gmail. Use this after processing a trigger-fired email to keep the inbox tidy. Can add and remove labels in one call. Output: { success, messageId }.',
  llmExamples: [
    {
      accountId: 1,
      messageId: '{{trigger.output.messageId}}',
      remove: ['INBOX', 'UNREAD'],
    },
    {
      accountId: 1,
      messageId: '{{trigger.output.messageId}}',
      add: ['STARRED'],
      remove: ['UNREAD'],
    },
    {
      accountId: 1,
      messageId: '{{input.messageId}}',
      add: ['Label_processed'],
      remove: ['INBOX'],
    },
  ],
  basicConfig: [
    {
      key: 'accountId',
      label: 'Gmail Account',
      type: 'number',
      description: 'The gmail_accounts row id.',
    },
    {
      key: 'messageId',
      label: 'Message ID',
      type: 'template-textarea',
      placeholder: '{{trigger.output.messageId}}',
      description: 'Gmail message id to label. Typically from trigger or search output.',
    },
    {
      key: 'add',
      label: 'Labels to Add',
      type: 'code',
      description: 'Array of label ids to apply. System labels: "STARRED", "IMPORTANT". Custom label ids visible in /admin/connections/gmail.',
    },
    {
      key: 'remove',
      label: 'Labels to Remove',
      type: 'code',
      description: 'Array of label ids to remove. Use ["INBOX"] to archive, ["UNREAD"] to mark as read.',
    },
  ],
};
