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

import { gmailSendExecutor } from '$lib/workflows/nodes/gmail-send';

describe('gmail-send', () => {
  it('sends a message and returns the result with sent:true', async () => {
    const sendResult = { messageId: 's1', threadId: 't1', rfc822MessageId: '<x@y>' };
    sendMessage.mockResolvedValueOnce(sendResult);

    const result = await gmailSendExecutor.execute(
      {},
      { accountId: 1, to: 'dest@example.com', subject: 'Hello', bodyText: 'World' },
      ctx,
    );

    expect(result.output).toMatchObject({ ...sendResult, sent: true });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ to: 'dest@example.com', subject: 'Hello', bodyText: 'World' }),
    );
  });

  it('interpolates templates for to, subject, body', async () => {
    const sendResult = { messageId: 's2', threadId: 't2', rfc822MessageId: '<a@b>' };
    sendMessage.mockResolvedValueOnce(sendResult);

    await gmailSendExecutor.execute(
      { to: 'friend@x.com', sub: 'Greetings', body: 'Hey there' },
      {
        accountId: 1,
        to: '{{input.to}}',
        subject: '{{input.sub}}',
        bodyText: '{{input.body}}',
      },
      ctx,
    );

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        to: 'friend@x.com',
        subject: 'Greetings',
        bodyText: 'Hey there',
      }),
    );
  });
});
