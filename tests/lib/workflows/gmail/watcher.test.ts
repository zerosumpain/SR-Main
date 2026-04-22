import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { GMAIL_TOKEN_ENCRYPTION_KEY: '0'.repeat(64) } }));

const { historyListSince, fetchMessage, listMessages, getLatestHistoryId, db } = vi.hoisted(() => {
  const historyListSince = vi.fn();
  const fetchMessage = vi.fn();
  const listMessages = vi.fn();
  const getLatestHistoryId = vi.fn();
  const db: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };
  return { historyListSince, fetchMessage, listMessages, getLatestHistoryId, db };
});

vi.mock('$lib/workflows/gmail/service', () => ({
  gmailService: {
    historyListSince: (...args: any[]) => historyListSince(...args),
    fetchMessage: (...args: any[]) => fetchMessage(...args),
    listMessages: (...args: any[]) => listMessages(...args),
    getLatestHistoryId: (...args: any[]) => getLatestHistoryId(...args),
  },
}));

vi.mock('$lib/db', () => ({ db }));
vi.mock('$lib/db/schema', () => ({
  gmailAccounts: { id: 'id', status: 'status' },
  gmailWatches: { accountId: 'accountId', enabled: 'enabled' },
  gmailHistoryCursors: { accountId: 'accountId' },
}));
vi.mock('drizzle-orm', () => ({ and: (...xs: any[]) => xs, eq: (a: any, b: any) => ({ eq: [a, b] }) }));

import { pollAccountOnce, gmailEventBus } from '$lib/workflows/gmail/watcher';

const emit = vi.fn();
gmailEventBus.on('gmail.message.received', (e) => emit(e));
gmailEventBus.on('gmail.auth.expired', (e) => emit(e));

describe('pollAccountOnce', () => {
  beforeEach(() => {
    historyListSince.mockReset();
    fetchMessage.mockReset();
    listMessages.mockReset();
    getLatestHistoryId.mockReset();
    emit.mockReset();
    db.where.mockReset();
    db.values.mockClear();
  });

  it('emits gmail.message.received for messages matching a watch query', async () => {
    const account = { id: 1, email: 'me@x.com', status: 'active' } as any;
    const watches = [{ id: 10, accountId: 1, label: 'recruiters', query: 'from:recruiter@x.com', enabled: true }];
    const cursor = { accountId: 1, historyId: '100' };

    db.where.mockResolvedValueOnce([cursor]);   // cursor read
    db.where.mockResolvedValueOnce(watches);    // watches read

    historyListSince.mockResolvedValue({ addedMessageIds: ['m1'], newHistoryId: '200' });
    listMessages.mockResolvedValue(['m1']); // watch query matches m1
    fetchMessage.mockResolvedValue({
      id: 'm1', threadId: 't1', labelIds: ['INBOX'], snippet: 'hey',
      headers: { from: 'recruiter@x.com', to: 'me@x.com', subject: 'Job', date: '', messageId: '<m1@x>' },
      bodyText: '', bodyHtml: '', attachments: [], historyId: '200', internalDate: '0',
    });

    await pollAccountOnce(account);

    expect(emit).toHaveBeenCalledTimes(1);
    const ev = emit.mock.calls[0][0];
    expect(ev.type).toBe('gmail.message.received');
    expect(ev.messageId).toBe('m1');
    expect(ev.watchLabel).toBe('recruiters');
  });

  it('initialises cursor to latest historyId on first poll (no emits)', async () => {
    const account = { id: 2, email: 'me@x.com', status: 'active' } as any;
    db.where.mockResolvedValueOnce([]); // no cursor
    getLatestHistoryId.mockResolvedValue('500');

    await pollAccountOnce(account);

    expect(historyListSince).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ accountId: 2, historyId: '500' }));
  });

  it('does not emit for messages that no watch matches', async () => {
    const account = { id: 3, email: 'me@x.com', status: 'active' } as any;
    const watches = [{ id: 20, accountId: 3, label: 'w', query: 'from:somebody@x.com', enabled: true }];
    db.where.mockResolvedValueOnce([{ accountId: 3, historyId: '1' }]);
    db.where.mockResolvedValueOnce(watches);

    historyListSince.mockResolvedValue({ addedMessageIds: ['m7'], newHistoryId: '2' });
    listMessages.mockResolvedValue([]); // no match — and any fallback match must also return empty

    await pollAccountOnce(account);

    expect(emit).not.toHaveBeenCalled();
  });
});
