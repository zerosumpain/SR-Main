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

import { gmailSearchExecutor } from '$lib/workflows/nodes/gmail-search';

describe('gmail-search', () => {
  it('returns ids only by default (no fetchFullMessages)', async () => {
    listMessages.mockResolvedValueOnce(['m1', 'm2']);

    const result = await gmailSearchExecutor.execute(
      {},
      { accountId: 1, query: 'label:inbox', maxResults: 50 },
      ctx,
    );

    expect(result.output.messageIds).toEqual(['m1', 'm2']);
    expect(result.output.count).toBe(2);
    expect(result.output.messages).toBeUndefined();
    expect(fetchMessage).not.toHaveBeenCalled();
  });

  it('fetches full messages when fetchFullMessages=true', async () => {
    listMessages.mockResolvedValueOnce(['m1', 'm2']);
    fetchMessage.mockResolvedValueOnce({ id: 'm1', headers: {}, bodyText: 'a' });
    fetchMessage.mockResolvedValueOnce({ id: 'm2', headers: {}, bodyText: 'b' });

    const result = await gmailSearchExecutor.execute(
      {},
      { accountId: 1, query: 'label:inbox', maxResults: 10, fetchFullMessages: true },
      ctx,
    );

    expect(result.output.messageIds).toEqual(['m1', 'm2']);
    expect(Array.isArray(result.output.messages)).toBe(true);
    expect((result.output.messages as any[]).length).toBe(2);
    expect(fetchMessage).toHaveBeenCalledTimes(2);
  });

  it('interpolates the query from input templates', async () => {
    listMessages.mockResolvedValueOnce(['m3']);

    await gmailSearchExecutor.execute(
      { q: 'from:boss@corp.com' },
      { accountId: 1, query: '{{input.q}}', maxResults: 25 },
      ctx,
    );

    expect(listMessages).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'from:boss@corp.com',
      25,
    );
  });
});
