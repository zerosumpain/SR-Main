import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

beforeAll(() => {
  process.env.INTEGRATION_CREDENTIALS_KEY = TEST_KEY;
});

beforeEach(async () => {
  const { __clearIntegrationAdapters } = await import('$lib/integrations/registry');
  __clearIntegrationAdapters();
  const { pendingState } = await import('$lib/integrations/oauth-pending-state');
  pendingState.clear();
});

describe('oauth callback', () => {
  it('exchanges code for tokens and writes a credential', async () => {
    const { registerIntegrationAdapter } = await import('$lib/integrations/registry');
    // pendingState is shared between the start + callback routes via this module
    const { pendingState } = await import('$lib/integrations/oauth-pending-state');
    const { GET } = await import('$lib/../routes/api/integrations/oauth/[integrationType]/callback/+server');
    process.env.TEST_OAUTH_CLIENT_ID = 'cid';
    process.env.TEST_OAUTH_CLIENT_SECRET = 'csecret';
    registerIntegrationAdapter({
      integrationType: 'test-callback',
      oauthSpec: {
        authorizationUrl: 'https://example.com/auth',
        tokenUrl: 'https://example.com/token',
        defaultScopes: ['read'],
        clientIdEnvVar: 'TEST_OAUTH_CLIENT_ID',
        clientSecretEnvVar: 'TEST_OAUTH_CLIENT_SECRET',
      },
    });
    pendingState.set('teststate', {
      integrationType: 'test-callback',
      label: 'My Test',
      scopes: ['read'],
      createdAt: Date.now(),
    });
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    const url = new URL('http://localhost/api/integrations/oauth/test-callback/callback?code=abc&state=teststate');
    // SvelteKit redirect() throws a Redirect object rather than returning a Response
    let redirected: { status: number; location: string } | undefined;
    try {
      await GET({
        params: { integrationType: 'test-callback' },
        url,
      } as any);
    } catch (e: any) {
      redirected = { status: e.status, location: e.location };
    }
    expect(redirected).toBeDefined();
    expect(redirected!.status).toBe(303);
    expect(redirected!.location).toMatch(/\/admin\/connections\/credentials\?credential=/);
    global.fetch = originalFetch;
  });

  it('errors on unknown state', async () => {
    const { registerIntegrationAdapter } = await import('$lib/integrations/registry');
    const { GET } = await import('$lib/../routes/api/integrations/oauth/[integrationType]/callback/+server');
    registerIntegrationAdapter({
      integrationType: 'test-bad-state',
      oauthSpec: {
        authorizationUrl: 'https://example.com/auth',
        tokenUrl: 'https://example.com/token',
        defaultScopes: [],
        clientIdEnvVar: 'TEST_OAUTH_CLIENT_ID',
        clientSecretEnvVar: 'TEST_OAUTH_CLIENT_SECRET',
      },
    });
    const url = new URL('http://localhost/?code=abc&state=nope');
    await expect(
      GET({ params: { integrationType: 'test-bad-state' }, url } as any),
    ).rejects.toMatchObject({ status: 400 });
  });
});
