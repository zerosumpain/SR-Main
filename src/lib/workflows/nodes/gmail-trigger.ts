import type { NodeExecutor } from '../types';

export { gmailTriggerDef } from './gmail-trigger.def';

export const gmailTriggerExecutor: NodeExecutor = {
  type: 'gmail-trigger',

  async execute(input: Record<string, unknown>) {
    const trigger = (input.gmail ?? {}) as Record<string, unknown>;

    if (!trigger || Object.keys(trigger).length === 0) {
      return { output: {}, rowCount: 1 };
    }

    return {
      output: {
        messageId: trigger.messageId,
        threadId: trigger.threadId,
        from: trigger.from,
        to: trigger.to,
        subject: trigger.subject,
        snippet: trigger.snippet,
        labels: trigger.labels,
        accountId: trigger.accountId,
        accountEmail: trigger.accountEmail,
        watchId: trigger.watchId,
        watchLabel: trigger.watchLabel,
        timestamp: trigger.timestamp,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Trigger payload from Gmail watcher' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        threadId: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        subject: { type: 'string' },
        snippet: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        accountId: { type: 'number' },
        accountEmail: { type: 'string' },
        watchId: { type: 'number' },
        watchLabel: { type: 'string' },
        timestamp: { type: 'string' },
      },
    };
  },
};
