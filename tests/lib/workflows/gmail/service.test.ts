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
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
        refreshAccessToken: mockRefreshAccessToken,
      })),
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
