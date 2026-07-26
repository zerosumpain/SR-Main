import { describe, it, expect } from 'vitest';
import { gmailTriggerExecutor, gmailTriggerDef } from '$lib/workflows/nodes/gmail-trigger';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

const mockContext: ExecutionContext = makeExecutionContext({ workflowId: '' });

describe('gmailTriggerExecutor', () => {
  it('passes the trigger event through as output', async () => {
    const trigger = {
      type: 'gmail.message.received',
      accountId: 1,
      accountEmail: 'me@x.com',
      watchId: 5,
      watchLabel: 'rec',
      messageId: 'm1',
      threadId: 't1',
      from: 'a@x.com',
      to: 'me@x.com',
      subject: 'Hi',
      snippet: 's',
      labels: ['INBOX'],
      timestamp: new Date().toISOString(),
    };
    const result = await gmailTriggerExecutor.execute(
      { gmail: trigger },
      {},
      mockContext,
    );
    expect(result.output.messageId).toBe('m1');
    expect(result.output.subject).toBe('Hi');
    expect(result.output.from).toBe('a@x.com');
    expect(result.output.threadId).toBe('t1');
    expect(result.output.to).toBe('me@x.com');
    expect(result.output.snippet).toBe('s');
    expect(result.output.labels).toEqual(['INBOX']);
    expect(result.output.accountId).toBe(1);
    expect(result.output.accountEmail).toBe('me@x.com');
    expect(result.output.watchId).toBe(5);
    expect(result.output.watchLabel).toBe('rec');
  });

  it('returns empty output when no gmail trigger attached (manual run)', async () => {
    const result = await gmailTriggerExecutor.execute({}, {}, mockContext);
    expect(result.output).toEqual({});
  });

  it('has correct type', () => {
    expect(gmailTriggerExecutor.type).toBe('gmail-trigger');
  });
});

describe('gmailTriggerDef', () => {
  it('is a trigger category', () => {
    expect(gmailTriggerDef.category).toBe('trigger');
  });

  it('has no inputs and one output', () => {
    expect(gmailTriggerDef.inputs).toHaveLength(0);
    expect(gmailTriggerDef.outputs).toHaveLength(1);
  });

  it('requires accountId in config schema', () => {
    expect(gmailTriggerDef.configSchema.required).toContain('accountId');
  });
});
