// Binding a catalogued API to a credential is the register editor's ONE write.
//
// Two things have to hold and neither is type-checked: the write must be narrow
// (a wide re-save would wipe the entry's description/capabilities/examples and
// roll `status` back — that is what `handleApiRegister` does), and a handle the
// owner never bound to this host must be refused with a sentence they can act
// on rather than becoming a 401 inside a cron run.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// apis.ts reaches the datastore at module scope; registry.ts reaches postgres.
// Stub both so this stays a pure test of the binding rules.
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/integrations/crypto', () => ({
  encryptPayload: (s: string) => `enc:${s}`,
  decryptPayload: (s: string) => s.replace(/^enc:/, ''),
}));

const updateRecord = vi.fn();
const getRecordByKey = vi.fn();

vi.mock('$lib/datastore', () => {
  class DatastoreError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    DatastoreError,
    getRecordByKey: (...args: unknown[]) => getRecordByKey(...args),
    queryRecords: async () => ({ records: [] }),
    updateRecord: (...args: unknown[]) => updateRecord(...args),
    upsertRecord: async () => ({ id: 'rec' }),
  };
});

// The real `hostAllowed` decides the pre-flight, so only the lookup is faked.
const getSecretMeta = vi.fn();
vi.mock('$lib/secrets/registry', async () => {
  const actual = await vi.importActual<typeof import('$lib/secrets/registry')>('$lib/secrets/registry');
  return { ...actual, getSecretMeta: (...args: unknown[]) => getSecretMeta(...args) };
});

import { setCatalogAuth } from './apis';

/** A fully-populated entry — every field here must survive a credential change. */
const TRUELAYER_ENTRY = {
  name: 'TrueLayer Data',
  baseUrl: 'https://api.truelayer.com/data/v1',
  description: 'Open-banking account and transaction data.',
  capabilities: ['accounts', 'transactions'],
  tags: ['banking'],
  auth: { kind: 'none' },
  exampleRequests: [{ label: 'accounts', method: 'GET', url: 'https://api.truelayer.com/data/v1/accounts' }],
  status: 'verified',
  source: 'jkai',
};

function meta(over: Record<string, unknown> = {}) {
  return {
    handle: 'truelayer',
    label: 'TrueLayer',
    source: 'ref',
    injection: { kind: 'bearer' },
    allowedHosts: ['api.truelayer.com'],
    allowedPathPrefixes: ['/data/v1'],
    allowedMethods: ['GET', 'HEAD'],
    available: true,
    useCount: 0,
    ...over,
  };
}

beforeEach(() => {
  updateRecord.mockReset();
  getRecordByKey.mockReset();
  getSecretMeta.mockReset();
  updateRecord.mockResolvedValue({ id: 'rec' });
  getRecordByKey.mockResolvedValue({ key: 'truelayer-data', data: { ...TRUELAYER_ENTRY } });
});

describe('setCatalogAuth', () => {
  it('writes only `auth`, so the rest of the catalogue entry survives', async () => {
    getSecretMeta.mockResolvedValue(meta());

    const result = await setCatalogAuth('truelayer-data', { kind: 'secret', handle: 'truelayer' });

    expect(result).toEqual({ key: 'truelayer-data', auth: { kind: 'secret', handle: 'truelayer' } });
    expect(updateRecord).toHaveBeenCalledTimes(1);
    const [slug, ref, changes] = updateRecord.mock.calls[0];
    expect(slug).toBe('api_catalog');
    expect(ref).toEqual({ key: 'truelayer-data' });
    // A `data` change would be the wide write — that is the handleApiRegister trap.
    expect(changes.data).toBeUndefined();
    expect(Object.keys(changes.patch)).toEqual(['auth']);

    // updateRecord merges patch over the stored data, so nothing else moves.
    const merged = { ...TRUELAYER_ENTRY, ...changes.patch };
    expect(merged.description).toBe(TRUELAYER_ENTRY.description);
    expect(merged.capabilities).toEqual(TRUELAYER_ENTRY.capabilities);
    expect(merged.exampleRequests).toEqual(TRUELAYER_ENTRY.exampleRequests);
    expect(merged.status).toBe('verified');
  });

  it('refuses a credential the owner never bound to this API\'s host', async () => {
    getSecretMeta.mockResolvedValue(meta({ handle: 'openrouter', allowedHosts: ['openrouter.ai'] }));

    await expect(setCatalogAuth('truelayer-data', { kind: 'secret', handle: 'openrouter' })).rejects.toThrow(
      /bound to openrouter\.ai and cannot be used for api\.truelayer\.com/,
    );
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it('refuses a store-only credential, which is never attached to a request', async () => {
    getSecretMeta.mockResolvedValue(
      meta({ handle: 'truelayer-oauth', injection: { kind: 'none' }, allowedHosts: ['api.truelayer.com'] }),
    );

    await expect(
      setCatalogAuth('truelayer-data', { kind: 'secret', handle: 'truelayer-oauth' }),
    ).rejects.toThrow(/store-only/);
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it('refuses a handle that is not in the registry at all', async () => {
    getSecretMeta.mockResolvedValue(null);

    await expect(setCatalogAuth('truelayer-data', { kind: 'secret', handle: 'nope' })).rejects.toThrow(
      /no credential registered under the handle "nope"/,
    );
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it('unbinds without consulting the registry', async () => {
    await setCatalogAuth('truelayer-data', { kind: 'none' });

    expect(getSecretMeta).not.toHaveBeenCalled();
    expect(updateRecord.mock.calls[0][2].patch).toEqual({ auth: { kind: 'none' } });
  });

  it('accepts a wildcard host binding', async () => {
    getSecretMeta.mockResolvedValue(meta({ allowedHosts: ['*.truelayer.com'] }));

    await expect(setCatalogAuth('truelayer-data', { kind: 'secret', handle: 'truelayer' })).resolves.toBeTruthy();
  });
});
