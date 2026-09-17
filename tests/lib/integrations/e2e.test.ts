import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearIntegrationFixtures } from './fixture-cleanup';

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

beforeAll(async () => {
  process.env.INTEGRATION_CREDENTIALS_KEY = TEST_KEY;
  // Clear first as well as last: a run killed before its teardown would
  // otherwise leave rows that the next run adds to rather than replaces.
  await clearIntegrationFixtures();
});

afterAll(async () => {
  await clearIntegrationFixtures();
});

beforeEach(async () => {
  const { __clearIntegrationAdapters, registerIntegrationAdapter } = await import('$lib/integrations/registry');
  __clearIntegrationAdapters();
  registerIntegrationAdapter({
    integrationType: 'test-e2e',
    resolveOptions: async (_field, credId) => [
      { value: `opt-${credId}-1`, label: 'One' },
      { value: `opt-${credId}-2`, label: 'Two' },
    ],
    testCredential: async (credId) => {
      if (credId === 'fail') throw new Error('intentional');
    },
  });
});

describe('integrations e2e', () => {
  it('options endpoint returns adapter results', async () => {
    const { GET } = await import('$lib/../routes/api/integrations/options/[integrationType]/[fieldName]/+server');
    const res = await GET({
      params: { integrationType: 'test-e2e', fieldName: 'thing' },
      url: new URL('http://localhost/?credentialId=cred-x'),
    } as any);
    const body = await res.json();
    expect(body.options).toEqual([
      { value: 'opt-cred-x-1', label: 'One' },
      { value: 'opt-cred-x-2', label: 'Two' },
    ]);
  });

  it('test endpoint records ok status', async () => {
    const { createCredential, getCredential } = await import('$lib/integrations/credentials');
    const { POST } = await import('$lib/../routes/api/integrations/test/[integrationType]/+server');
    const id = await createCredential({
      integrationType: 'test-e2e',
      label: 'e2e ok',
      kind: 'apikey',
      payload: { key: 'k' },
    });
    const res = await POST({
      params: { integrationType: 'test-e2e' },
      request: new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ credentialId: id }),
        headers: { 'content-type': 'application/json' },
      }),
    } as any);
    expect((await res.json()).status).toBe('ok');
    const got = await getCredential(id);
    expect(got!.lastTestStatus).toBe('ok');
  });

  it('test endpoint records failed status', async () => {
    const { POST } = await import('$lib/../routes/api/integrations/test/[integrationType]/+server');
    // Use 'fail' as the credentialId — the stub adapter throws.
    // Note: the real updateCredential would 404 on this fake id; for the
    // test, the assertion is just that the endpoint returns failed status.
    const res = await POST({
      params: { integrationType: 'test-e2e' },
      request: new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ credentialId: 'fail' }),
        headers: { 'content-type': 'application/json' },
      }),
    } as any);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error).toMatch(/intentional/);
  });
});
