import { describe, it, expect, vi } from 'vitest';

const { fetchMessage, sendMessage, modifyLabels, listMessages, dbMock } = vi.hoisted(() => ({
  fetchMessage: vi.fn(),
  sendMessage: vi.fn(),
  modifyLabels: vi.fn(),
  listMessages: vi.fn(),
  dbMock: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ id: 1, email: 'me@example.com', refreshTokenEnc: 'x', status: 'active' }]),
  },
}));

vi.mock('$lib/workflows/gmail/service', () => ({
  gmailService: {
    fetchMessage: (...a: any[]) => fetchMessage(...a),
    sendMessage: (...a: any[]) => sendMessage(...a),
    modifyLabels: (...a: any[]) => modifyLabels(...a),
    listMessages: (...a: any[]) => listMessages(...a),
  },
}));
vi.mock('$lib/db', () => ({ db: dbMock }));
vi.mock('$lib/db/schema', () => ({ gmailAccounts: { id: 'id', email: 'email' } }));
vi.mock('drizzle-orm', () => ({ eq: (a: any, b: any) => ({ a, b }) }));

const ctx: any = { runId: 'r', emit: vi.fn(), getNodeOutput: () => undefined };

import { gmailReplyExecutor } from '$lib/workflows/nodes/gmail-reply';

describe('gmail-reply', () => {
  it('preserves threadId + In-Reply-To + References on send', async () => {
    const sendResult = { messageId: 'r1', threadId: 'th1', rfc822MessageId: '<r@y>' };
    sendMessage.mockResolvedValueOnce(sendResult);

    const result = await gmailReplyExecutor.execute(
      { from: 'sender@x.com' },
      {
        accountId: 1,
        to: '{{input.from}}',
        threadId: 'th1',
        inReplyTo: '<orig@x.com>',
        references: '<orig@x.com>',
        subject: 'Re: Hello',
        bodyText: 'Reply body',
      },
      ctx,
    );

    expect(result.output).toMatchObject({ ...sendResult, sent: true });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        to: 'sender@x.com',
        threadId: 'th1',
        inReplyTo: '<orig@x.com>',
        references: '<orig@x.com>',
        subject: 'Re: Hello',
        bodyText: 'Reply body',
      }),
    );
  });

  it('defaults references to inReplyTo when not provided', async () => {
    const sendResult = { messageId: 'r2', threadId: 'th2', rfc822MessageId: '<r2@y>' };
    sendMessage.mockResolvedValueOnce(sendResult);

    await gmailReplyExecutor.execute(
      { from: 'sender@x.com' },
      {
        accountId: 1,
        to: '{{input.from}}',
        threadId: 'th2',
        inReplyTo: '<orig2@x.com>',
        subject: 'Re: Test',
        bodyText: 'Body',
      },
      ctx,
    );

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        inReplyTo: '<orig2@x.com>',
        references: '<orig2@x.com>',
      }),
    );
  });
});
