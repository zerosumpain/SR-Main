import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

beforeAll(() => {
  process.env.INTEGRATION_CREDENTIALS_KEY = TEST_KEY;
});

// These tests run against the dev DB. They isolate by using a synthetic
// integrationType prefixed with 'test-' and clean up between tests.
const TEST_TYPE_PREFIX = 'test-creds-';

beforeEach(async () => {
  const { db } = await import('$lib/db');
  const { integrationCredentials } = await import('$lib/db/schema');
  const { like } = await import('drizzle-orm');
  await db
    .delete(integrationCredentials)
    .where(like(integrationCredentials.integrationType, `${TEST_TYPE_PREFIX}%`));
});

describe('integrations/credentials', () => {
  it('creates and retrieves a basic credential', async () => {
    const { createCredential, getCredential } = await import('$lib/integrations/credentials');
    const integrationType = `${TEST_TYPE_PREFIX}basic`;
    const id = await createCredential({
      integrationType,
      label: 'My Test',
      kind: 'basic',
      payload: { username: 'john', password: 's3cret' },
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const got = await getCredential(id);
    expect(got).not.toBeNull();
    expect(got!.kind).toBe('basic');
    expect(got!.label).toBe('My Test');
    expect(got!.payload).toEqual({ username: 'john', password: 's3cret' });
  });

  it('lists credentials filtered by integrationType', async () => {
    const { createCredential, listCredentials } = await import('$lib/integrations/credentials');
    const t = `${TEST_TYPE_PREFIX}list`;
    await createCredential({ integrationType: t, label: 'A', kind: 'apikey', payload: { key: 'k1' } });
    await createCredential({ integrationType: t, label: 'B', kind: 'apikey', payload: { key: 'k2' } });
    const list = await listCredentials(t);
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.label).sort()).toEqual(['A', 'B']);
    // listCredentials must NOT decrypt payloads (it returns row metadata only).
    expect((list[0] as unknown as { payload?: unknown }).payload).toBeUndefined();
  });

  it('updates label and payload', async () => {
    const { createCredential, updateCredential, getCredential } = await import('$lib/integrations/credentials');
    const t = `${TEST_TYPE_PREFIX}update`;
    const id = await createCredential({ integrationType: t, label: 'old', kind: 'apikey', payload: { key: 'k1' } });
    await updateCredential(id, { label: 'new', payload: { key: 'k2' } });
    const got = await getCredential(id);
    expect(got!.label).toBe('new');
    expect(got!.payload).toEqual({ key: 'k2' });
  });

  it('deletes', async () => {
    const { createCredential, deleteCredential, getCredential } = await import('$lib/integrations/credentials');
    const t = `${TEST_TYPE_PREFIX}delete`;
    const id = await createCredential({ integrationType: t, label: 'gone', kind: 'apikey', payload: { key: 'x' } });
    await deleteCredential(id);
    expect(await getCredential(id)).toBeNull();
  });

  it('returns null for unknown id', async () => {
    const { getCredential } = await import('$lib/integrations/credentials');
    expect(await getCredential('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('ensureFreshAccessToken', () => {
  it('returns the existing access token when not yet expired', async () => {
    const { createCredential, ensureFreshAccessToken } = await import('$lib/integrations/credentials');
    const id = await createCredential({
      integrationType: `${TEST_TYPE_PREFIX}oauth-fresh`,
      label: 'fresh',
      kind: 'oauth2',
      payload: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + 60 * 60 * 1000,
      },
    });
    const token = await ensureFreshAccessToken(id);
    expect(token).toBe('access-1');
  });

  it('refreshes via the adapter when expired', async () => {
    const { createCredential, ensureFreshAccessToken, getCredential } = await import('$lib/integrations/credentials');
    const { registerIntegrationAdapter, __clearIntegrationAdapters } = await import('$lib/integrations/registry');
    __clearIntegrationAdapters();
    const integrationType = `${TEST_TYPE_PREFIX}oauth-stale`;
    process.env.TEST_OAUTH_CLIENT_ID = 'cid';
    process.env.TEST_OAUTH_CLIENT_SECRET = 'csecret';
    let tokenUrlHit: string | undefined;
    const originalFetch = global.fetch;
    global.fetch = (async (url: RequestInfo | URL) => {
      tokenUrlHit = String(url);
      return new Response(
        JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      registerIntegrationAdapter({
        integrationType,
        oauthSpec: {
          authorizationUrl: 'https://example.com/auth',
          tokenUrl: 'https://example.com/token',
          defaultScopes: [],
          clientIdEnvVar: 'TEST_OAUTH_CLIENT_ID',
          clientSecretEnvVar: 'TEST_OAUTH_CLIENT_SECRET',
        },
      });
      const id = await createCredential({
        integrationType,
        label: 'stale',
        kind: 'oauth2',
        payload: {
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresAt: Date.now() - 1000,
        },
      });
      const token = await ensureFreshAccessToken(id);
      expect(token).toBe('access-2');
      expect(tokenUrlHit).toBe('https://example.com/token');
      const got = await getCredential(id);
      expect(got!.payload).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('throws if credential is not oauth2', async () => {
    const { createCredential, ensureFreshAccessToken } = await import('$lib/integrations/credentials');
    const id = await createCredential({
      integrationType: `${TEST_TYPE_PREFIX}wrong-kind`,
      label: 'x',
      kind: 'apikey',
      payload: { key: 'k' },
    });
    await expect(ensureFreshAccessToken(id)).rejects.toThrow(/oauth2/);
  });
});
