// Unit tests for the secret registry's OAuth2 token exchange.
//
// The behaviours worth pinning down are the ones whose failure modes are silent
// and slow: dropping a rotated refresh token bricks the connection weeks later,
// and a concurrent double-exchange bricks it immediately. Both are covered here.

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The single fake `api_secrets` row the mocked db reads and writes. */
let storedPayload: string;
let storedHosts: string[] = ['auth.truelayer.com', 'api-m.paypal.com'];
let updateCount = 0;

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            { handle: 'truelayer-oauth', payloadEnc: storedPayload, allowedHosts: storedHosts },
          ],
        }),
      }),
    }),
    update: () => ({
      set: (v: { payloadEnc: string }) => ({
        where: async () => {
          storedPayload = v.payloadEnc;
          updateCount += 1;
        },
      }),
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({ apiSecrets: { handle: 'handle' } }));

// Identity "encryption" — the real AES-GCM round-trip is covered by the crypto
// module's own tests; here it would only obscure what the payload contains.
vi.mock('$lib/integrations/crypto', () => ({
  encryptPayload: (s: string) => s,
  decryptPayload: (s: string) => s,
}));

const { getOAuthAccessToken, OAuthRefreshError } = await import('$lib/secrets/oauth-refresh');

const now = () => Math.floor(Date.now() / 1000);

function seed(cred: Record<string, unknown>) {
  storedPayload = JSON.stringify({
    client_id: 'cid-1234',
    client_secret: 'shhh-secret',
    refresh_token: 'refresh-A',
    ...cred,
  });
}

function mockTokenEndpoint(body: Record<string, unknown>, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  updateCount = 0;
  storedHosts = ['auth.truelayer.com', 'api-m.paypal.com'];
  vi.restoreAllMocks();
});

describe('getOAuthAccessToken', () => {
  it('uses the cached token and makes no network call while it is still fresh', async () => {
    seed({ access_token: 'cached-token', expires_at: now() + 600 });
    const f = mockTokenEndpoint({});
    vi.stubGlobal('fetch', f);

    await expect(getOAuthAccessToken('truelayer')).resolves.toBe('cached-token');
    expect(f).not.toHaveBeenCalled();
    expect(updateCount).toBe(0);
  });

  it('refreshes when the cached token is inside the 60s expiry buffer', async () => {
    seed({ access_token: 'stale-token', expires_at: now() + 30 });
    vi.stubGlobal('fetch', mockTokenEndpoint({ access_token: 'fresh-token', expires_in: 3600 }));

    await expect(getOAuthAccessToken('truelayer')).resolves.toBe('fresh-token');
  });

  it('persists a rotated refresh token — dropping it would brick the connection', async () => {
    seed({ access_token: 'old', expires_at: now() - 10 });
    vi.stubGlobal(
      'fetch',
      mockTokenEndpoint({ access_token: 'fresh', expires_in: 3600, refresh_token: 'refresh-B' }),
    );

    await getOAuthAccessToken('truelayer');

    const saved = JSON.parse(storedPayload);
    expect(saved.refresh_token).toBe('refresh-B');
    expect(saved.access_token).toBe('fresh');
    expect(saved.expires_at).toBeGreaterThan(now());
  });

  it('keeps the existing refresh token when the provider does not issue a new one', async () => {
    seed({ access_token: 'old', expires_at: now() - 10 });
    vi.stubGlobal('fetch', mockTokenEndpoint({ access_token: 'fresh', expires_in: 3600 }));

    await getOAuthAccessToken('truelayer');
    expect(JSON.parse(storedPayload).refresh_token).toBe('refresh-A');
  });

  it('de-duplicates concurrent resolves so a rotating token is exchanged once', async () => {
    seed({ access_token: 'old', expires_at: now() - 10 });
    const f = mockTokenEndpoint({ access_token: 'fresh', expires_in: 3600, refresh_token: 'refresh-B' });
    vi.stubGlobal('fetch', f);

    const results = await Promise.all([
      getOAuthAccessToken('truelayer'),
      getOAuthAccessToken('truelayer'),
      getOAuthAccessToken('truelayer'),
    ]);

    expect(results).toEqual(['fresh', 'fresh', 'fresh']);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('never leaks the client_secret in an error, and names the owner action', async () => {
    seed({ access_token: 'old', expires_at: now() - 10 });
    vi.stubGlobal(
      'fetch',
      // A real provider can echo the credential back in an error body.
      mockTokenEndpoint({ error: 'invalid_grant', client_secret: 'shhh-secret' }, false, 400),
    );

    await expect(getOAuthAccessToken('truelayer')).rejects.toThrow(OAuthRefreshError);
    await expect(getOAuthAccessToken('truelayer')).rejects.toThrow(/re-authorise at \/admin\/ai\/apis/);
    await expect(getOAuthAccessToken('truelayer')).rejects.not.toThrow(/shhh-secret/);
  });

  it('rejects a truelayer credential with no refresh_token rather than sending a bad grant', async () => {
    storedPayload = JSON.stringify({ client_id: 'cid', client_secret: 'sec', expires_at: now() - 10 });
    const f = mockTokenEndpoint({});
    vi.stubGlobal('fetch', f);

    await expect(getOAuthAccessToken('truelayer')).rejects.toThrow(/no refresh_token/);
    expect(f).not.toHaveBeenCalled();
  });

  it('uses HTTP Basic for paypal client_credentials and stores no refresh token', async () => {
    storedPayload = JSON.stringify({ client_id: 'pp-id', client_secret: 'pp-sec' });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'pp-tok', expires_in: 32400 }) };
      }) as unknown as typeof fetch,
    );

    await expect(getOAuthAccessToken('paypal')).resolves.toBe('pp-tok');

    const { url, init } = calls[0];
    expect(url).toBe('https://api-m.paypal.com/v1/oauth2/token');
    expect(String(init.body)).toContain('grant_type=client_credentials');
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(Buffer.from(auth.replace('Basic ', ''), 'base64').toString()).toBe('pp-id:pp-sec');
    expect(JSON.parse(storedPayload).refresh_token).toBeUndefined();
  });

  it('reports an actionable message when the vault row is missing its payload', async () => {
    storedPayload = '';
    await expect(getOAuthAccessToken('truelayer')).rejects.toThrow(/has no stored value/);
  });

  it('refuses to send the credential to a host the row is not bound to', async () => {
    seed({ access_token: 'old', expires_at: now() - 10 });
    storedHosts = ['evil.example.com'];
    const f = mockTokenEndpoint({ access_token: 'nope' });
    vi.stubGlobal('fetch', f);

    await expect(getOAuthAccessToken('truelayer')).rejects.toThrow(/not bound to "auth\.truelayer\.com"/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('the documented vault-row setup is actually creatable', () => {
  // REGRESSION. The module originally documented the vault row's allowedHosts as
  // "stay empty". registry.validateHosts rejects an empty list outright, so the
  // row could never be created through /admin/ai/apis and the whole feature was
  // unusable. This asserts the documented host is present and non-empty, which
  // is exactly the precondition upsertSecret enforces.
  it('every provider declares a non-empty token host for its vault row', async () => {
    const { OAUTH_PROVIDERS } = await import('$lib/secrets/oauth-refresh');
    for (const [name, p] of Object.entries(OAUTH_PROVIDERS)) {
      expect(p.tokenHost, `${name} tokenHost`).toBeTruthy();
      expect(p.tokenUrl, `${name} tokenUrl must sit on tokenHost`).toContain(p.tokenHost);
      expect(p.dataHost, `${name} dataHost`).toBeTruthy();
      expect(p.vaultHandle, `${name} vaultHandle`).toMatch(/-oauth$/);
    }
  });

  it('the declared token host survives registry host validation', async () => {
    // Import the real validator rather than asserting a regex by eye.
    const { hostMatchesPattern } = await import('$lib/secrets/registry');
    const { OAUTH_PROVIDERS } = await import('$lib/secrets/oauth-refresh');
    for (const p of Object.values(OAUTH_PROVIDERS)) {
      expect(hostMatchesPattern(p.tokenHost, p.tokenHost)).toBe(true);
    }
  });
});
