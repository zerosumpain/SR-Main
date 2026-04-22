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

import { gmailFetchExecutor } from '$lib/workflows/nodes/gmail-fetch';

describe('gmail-fetch', () => {
  it('fetches a message and returns its full shape', async () => {
    const msg = { id: 'm1', headers: { subject: 'Hi', from: 'a@x' }, bodyText: 'hello' };
    fetchMessage.mockResolvedValueOnce(msg);

    const result = await gmailFetchExecutor.execute(
      {},
      { messageId: 'm1', accountId: 1 },
      ctx,
    );

    expect(result.output).toEqual(msg);
    expect(fetchMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'm1',
    );
  });

  it('interpolates messageId from input', async () => {
    const msg = { id: 'm99', headers: {}, bodyText: '' };
    fetchMessage.mockResolvedValueOnce(msg);

    await gmailFetchExecutor.execute(
      { messageId: 'm99' },
      { messageId: '{{input.messageId}}', accountId: 1 },
      ctx,
    );

    expect(fetchMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'm99',
    );
  });
});
