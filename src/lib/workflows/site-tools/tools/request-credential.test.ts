// The guard on `request_credential`'s arguments.
//
// Two failure modes, pulling in opposite directions, and both have bitten:
//
//   * a model that puts the key itself in the arguments leaks it to the
//     transcript, because the MCP dispatcher publishes args to the SSE stream
//     BEFORE the handler runs (2026-08-01);
//   * a guard applied too widely refuses correct calls — `update_credential`
//     rejected the perfectly ordinary handle `companies-house-production`
//     because 25 characters is shorter than it looks (#82).
//
// The second is now the live risk here: the model describes the FIELDS a service
// asks for, so its arguments legitimately contain long identifiers and vendor
// URLs.

import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/integrations/crypto', () => ({
  encryptPayload: (s: string) => `enc:${s}`,
  decryptPayload: (s: string) => s.replace(/^enc:/, ''),
}));
// No row is registered under any handle these tests propose.
vi.mock('$lib/secrets/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/secrets/registry')>()),
  getSecretMeta: vi.fn(async () => null),
}));

import { handleRequestCredential, looksLikeCredential, specForRequest } from './request-credential';

/** With no browser attached the handler stops at the form step, which is far
 *  enough past the guard to prove the call was accepted. */
const ACCEPTED = { success: true, data: { status: 'unattended', note: expect.any(String) } };

describe('arguments that carry a credential', () => {
  it('refuses a key pasted into the reason', async () => {
    const res = await handleRequestCredential({
      provider: 'custom',
      reason: 'store this key sk-or-v1-9f8e7d6c5b4a39281706fedcba9876543210',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/credential-shaped/);
  });

  it('refuses an unbroken token in the suggested host', async () => {
    const res = await handleRequestCredential({
      provider: 'custom',
      reason: 'to read departures',
      custom: { suggestedHost: 'tlcs0live0abcdef0123456789abcdef' },
    });
    expect(res.success).toBe(false);
  });

  it('still catches a vendor-prefixed key wherever it is hidden', async () => {
    const res = await handleRequestCredential({
      provider: 'custom',
      reason: 'to read departures',
      custom: { fields: [{ key: 'k', label: 'Key', help: 'use sk-ant-api03-not-a-real-one' }] },
    });
    expect(res.success).toBe(false);
  });
});

describe('correct calls the guard must not refuse', () => {
  it('accepts a long field key', async () => {
    // 30 characters of [a-z0-9_] — over the run-length threshold, and entirely
    // ordinary as a field name.
    expect(
      await handleRequestCredential({
        provider: 'custom',
        reason: 'to read departures',
        custom: {
          suggestedHost: 'api1.raildata.org.uk',
          fields: [{ key: 'bootstrap_servers_endpoint_url', label: 'Bootstrap server' }],
        },
      }),
    ).toMatchObject(ACCEPTED);
  });

  it('accepts help text carrying a vendor URL with a uuid in it', async () => {
    expect(
      await handleRequestCredential({
        provider: 'custom',
        reason: 'to read departures',
        custom: {
          suggestedHost: 'api1.raildata.org.uk',
          fields: [
            {
              key: 'consumer_key',
              label: 'Consumer key',
              help: 'https://raildata.org.uk/dashboard/dataProduct/P-2eec03eb-4d53-4955-8a96-0314964a4e9e/overview',
            },
          ],
        },
      }),
    ).toMatchObject(ACCEPTED);
  });

  it('accepts a catalogued Darwin request', async () => {
    expect(
      await handleRequestCredential({ provider: 'darwin-pubsub', reason: 'to read live train movements' }),
    ).toMatchObject(ACCEPTED);
  });
});

describe('proposals that cannot work', () => {
  it('tells the model what to fix rather than failing opaquely', async () => {
    const res = await handleRequestCredential({
      provider: 'custom',
      reason: 'to read departures',
      custom: {
        suggestedHost: 'api.example.com',
        fields: [{ key: 'user', label: 'User' }, { key: 'pass', label: 'Pass' }],
        auth: { style: 'bearer' },
      },
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/multi-field set|auth\.field|basic/);
  });

  it('rejects an unknown provider by name', async () => {
    const res = await handleRequestCredential({ provider: 'not-a-provider', reason: 'x' });
    expect(res.error).toMatch(/unknown provider/);
  });
});

describe('specForRequest', () => {
  it('builds the catalogued spec for a known provider', () => {
    expect(specForRequest({ provider: 'darwin-ldbws' })?.binding.handle).toBe('darwin-ldbws');
  });

  it('returns null for a provider that is not catalogued', () => {
    expect(specForRequest({ provider: 'nope' })).toBeNull();
  });
});

describe('looksLikeCredential', () => {
  it('fires on an unbroken 25-character run and not on ordinary prose', () => {
    expect(looksLikeCredential('sk-or-v1-9f8e7d6c5b4a39281706fedcba')).toBe(true);
    expect(looksLikeCredential('to read your live departure boards')).toBe(false);
  });
});
