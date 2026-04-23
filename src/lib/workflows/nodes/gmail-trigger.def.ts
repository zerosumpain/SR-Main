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
  basicConfig: [
    {
      key: 'accountId',
      label: 'Gmail Account',
      type: 'number',
      description: 'The gmail_accounts row id for the account to watch. Configure accounts at /admin/gmail.',
    },
    {
      key: 'watchId',
      label: 'Watch Filter (optional)',
      type: 'number',
      description: 'Restrict to a specific gmail_watches row. If blank, the trigger fires for any matching message on the account.',
      section: 'ADVANCED',
      advancedOnly: true,
    },
  ],
  llmDescription: 'Start node that fires automatically when the Gmail watcher detects a new message matching a configured watch query on the given account. Always the first node in Gmail-driven workflows — nothing upstream of it. Output shape: { messageId, threadId, from, to, subject, snippet, labels, accountId, accountEmail, watchId, timestamp }. Use accountId to identify which connected Gmail account to monitor; set watchId if you only want emails matching a specific saved search. Downstream nodes typically reference {{trigger.output.messageId}}, {{trigger.output.threadId}}, and {{trigger.output.from}}. Pair with gmail-fetch immediately after to get the full body and attachments.',
  llmExamples: [
    { accountId: 1 },
    { accountId: 1, watchId: 3 },
  ],
};
