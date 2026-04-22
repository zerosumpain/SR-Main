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

import { gmailLabelExecutor } from '$lib/workflows/nodes/gmail-label';

describe('gmail-label', () => {
  it('adds + removes labels and returns the result', async () => {
    modifyLabels.mockResolvedValueOnce(undefined);

    const result = await gmailLabelExecutor.execute(
      {},
      { accountId: 1, messageId: 'msg1', add: ['STARRED'], remove: ['UNREAD', 'INBOX'] },
      ctx,
    );

    expect(result.output).toMatchObject({
      ok: true,
      messageId: 'msg1',
      added: ['STARRED'],
      removed: ['UNREAD', 'INBOX'],
    });
    expect(modifyLabels).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'msg1',
      ['STARRED'],
      ['UNREAD', 'INBOX'],
    );
  });

  it('defaults add/remove to empty arrays when unset', async () => {
    modifyLabels.mockResolvedValueOnce(undefined);

    const result = await gmailLabelExecutor.execute(
      {},
      { accountId: 1, messageId: 'msg2' },
      ctx,
    );

    expect(modifyLabels).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'msg2',
      [],
      [],
    );
    expect(result.output).toMatchObject({ ok: true, added: [], removed: [] });
  });
});
