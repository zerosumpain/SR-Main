import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRefreshAccessToken, mockRequest, dbMock } = vi.hoisted(() => {
  const mockRefreshAccessToken = vi.fn();
  const mockRequest = vi.fn();
  const dbMock = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return { mockRefreshAccessToken, mockRequest, dbMock };
});

vi.mock('$env/dynamic/private', () => ({
  env: {
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    GMAIL_TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
  },
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(function () {
        return {
          setCredentials: vi.fn(),
          refreshAccessToken: mockRefreshAccessToken,
        };
      }),
    },
    gmail: vi.fn(() => ({
      users: {
        getProfile: vi.fn(),
        messages: { get: mockRequest, list: mockRequest, send: mockRequest, modify: mockRequest },
        history: { list: mockRequest },
      },
    })),
  },
}));

vi.mock('$lib/db', () => ({ db: dbMock }));
vi.mock('$lib/db/schema', () => ({ gmailAccounts: { id: 'id' } }));
vi.mock('drizzle-orm', () => ({ eq: (a: any, b: any) => ({ a, b }) }));

import { GmailService } from '$lib/workflows/gmail/service';
import { encryptToken } from '$lib/workflows/gmail/crypto';

describe('GmailService.getAuthenticatedClient', () => {
  beforeEach(() => {
    mockRefreshAccessToken.mockReset();
    dbMock.set.mockClear();
  });

  it('refreshes expired access token and persists new one', async () => {
    mockRefreshAccessToken.mockResolvedValue({
      credentials: { access_token: 'new-access', expiry_date: Date.now() + 3600_000 },
    });

    const svc = new GmailService();
    const account = {
      id: 1,
      email: 'john@example.com',
      refreshTokenEnc: encryptToken('refresh-abc'),
      accessTokenEnc: encryptToken('old-access'),
      accessTokenExpiresAt: new Date(Date.now() - 1000), // expired
      scopes: 'gmail.modify gmail.send',
      status: 'active',
    } as any;

    await svc.getAuthenticatedClient(account);

    expect(mockRefreshAccessToken).toHaveBeenCalled();
    expect(dbMock.set).toHaveBeenCalled();
    const setArg = dbMock.set.mock.calls[0][0];
    expect(setArg.accessTokenEnc).toBeDefined();
    expect(setArg.accessTokenExpiresAt).toBeInstanceOf(Date);
  });

  it('marks account auth_expired and throws on invalid_grant', async () => {
    const err: any = new Error('invalid_grant');
    err.response = { data: { error: 'invalid_grant' } };
    mockRefreshAccessToken.mockRejectedValue(err);

    const svc = new GmailService();
    const account = {
      id: 2,
      email: 'x@example.com',
      refreshTokenEnc: encryptToken('bad'),
      accessTokenExpiresAt: new Date(0),
      scopes: '',
      status: 'active',
    } as any;

    await expect(svc.getAuthenticatedClient(account)).rejects.toThrow(/invalid_grant|auth_expired/i);
    const setArg = dbMock.set.mock.calls.at(-1)?.[0];
    expect(setArg?.status).toBe('auth_expired');
  });
});

describe('GmailService.fetchMessage', () => {
  it('parses headers + text + html + attachments', async () => {
    mockRequest.mockResolvedValueOnce({
      data: {
        id: 'm1',
        threadId: 't1',
        labelIds: ['INBOX', 'UNREAD'],
        snippet: 'hello world',
        historyId: '12345',
        internalDate: '1700000000000',
        payload: {
          headers: [
            { name: 'From', value: 'alice@x.com' },
            { name: 'To', value: 'me@x.com' },
            { name: 'Subject', value: 'Hi' },
            { name: 'Date', value: 'Mon, 1 Jan 2024' },
            { name: 'Message-ID', value: '<abc@x.com>' },
          ],
          mimeType: 'multipart/mixed',
          parts: [
            { mimeType: 'text/plain', body: { data: Buffer.from('Hello').toString('base64url') } },
            { mimeType: 'text/html', body: { data: Buffer.from('<b>Hi</b>').toString('base64url') } },
            { mimeType: 'application/pdf', filename: 'x.pdf',
              body: { attachmentId: 'att1', size: 1024 } },
          ],
        },
      },
    });

    const svc = new GmailService();
    const account = { id: 1, refreshTokenEnc: encryptToken('r'), accessTokenEnc: encryptToken('a'),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000), email: 'me@x.com', scopes: '', status: 'active' } as any;

    const msg = await svc.fetchMessage(account, 'm1');
    expect(msg.id).toBe('m1');
    expect(msg.headers.from).toBe('alice@x.com');
    expect(msg.headers.subject).toBe('Hi');
    expect(msg.bodyText).toBe('Hello');
    expect(msg.bodyHtml).toBe('<b>Hi</b>');
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe('x.pdf');
  });
});

describe('GmailService.sendMessage', () => {
  it('builds RFC822 message and sends', async () => {
    mockRequest.mockResolvedValueOnce({ data: { id: 'sent1', threadId: 't2' } });

    const svc = new GmailService();
    const account = { id: 1, refreshTokenEnc: encryptToken('r'), accessTokenEnc: encryptToken('a'),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000), email: 'me@x.com', scopes: '', status: 'active' } as any;

    const result = await svc.sendMessage(account, {
      to: 'b@x.com',
      subject: 'Hey',
      bodyText: 'body',
    });

    expect(result.messageId).toBe('sent1');
    expect(result.threadId).toBe('t2');
    const call = mockRequest.mock.calls.at(-1)![0];
    expect(call.requestBody.raw).toBeDefined();
    const decoded = Buffer.from(call.requestBody.raw, 'base64url').toString('utf8');
    expect(decoded).toContain('To: b@x.com');
    expect(decoded).toContain('Subject: Hey');
    expect(decoded).toContain('body');
  });

  it('preserves In-Reply-To and References when threading', async () => {
    mockRequest.mockResolvedValueOnce({ data: { id: 's2', threadId: 't3' } });
    const svc = new GmailService();
    const account = { id: 1, refreshTokenEnc: encryptToken('r'), accessTokenEnc: encryptToken('a'),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000), email: 'me@x.com', scopes: '', status: 'active' } as any;

    await svc.sendMessage(account, {
      to: 'b@x.com',
      subject: 'Re: Hey',
      bodyText: 'reply',
      inReplyTo: '<orig@x.com>',
      references: '<orig@x.com>',
      threadId: 't3',
    });

    const call = mockRequest.mock.calls.at(-1)![0];
    const decoded = Buffer.from(call.requestBody.raw, 'base64url').toString('utf8');
    expect(decoded).toContain('In-Reply-To: <orig@x.com>');
    expect(decoded).toContain('References: <orig@x.com>');
    expect(call.requestBody.threadId).toBe('t3');
  });
});
