// A host that holds no API registry must not grow one back. Two paths recreate
// it and both are easy to miss:
//
//   - the boot seeder (`ensureSystemCollections` + `seedApiCatalog`), which runs
//     on EVERY host before the self-improvement engine's own prod gate;
//   - `ensureIntegrationsCollection`, which is called lazily at the top of every
//     integration read AND write, so the collection reappears the moment
//     anything so much as lists integrations.
//
// Patching only the first leaves the second, and a purge silently undoes itself
// on the next restart. These tests pin both, and pin that the flag changes
// NOTHING when it is unset — production must be untouched.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The seeder's "does this key already exist?" probe swallows a not_found and
// rethrows anything else, so the miss has to be a real DatastoreError — a plain
// Error with a `code` property is a different class and escapes.
const h = vi.hoisted(() => {
  class DatastoreError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'DatastoreError';
      this.code = code;
    }
  }
  return {
    DatastoreError,
    ensureCollection: vi.fn(async () => undefined),
    getRecordByKey: vi.fn(async () => {
      throw new DatastoreError('not_found', 'no such record');
    }),
    upsertRecord: vi.fn(async () => ({ id: 'rec' })),
  };
});

const { ensureCollection, getRecordByKey, upsertRecord } = h;

vi.mock('$lib/datastore', () => ({
  DatastoreError: h.DatastoreError,
  ensureCollection: (...a: unknown[]) => h.ensureCollection(...(a as [])),
  getRecordByKey: (...a: unknown[]) => h.getRecordByKey(...(a as [])),
  upsertRecord: (...a: unknown[]) => h.upsertRecord(...(a as [])),
  queryRecords: async () => ({ records: [] }),
  deleteRecord: async () => true,
  updateRecord: async () => ({ id: 'rec' }),
}));

// Only the side-effecting seeder is stubbed; the constants are re-exported by
// selfimprove/types.ts, so dropping them breaks the import graph.
vi.mock('$lib/toolpolicy/policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/toolpolicy/policy')>()),
  ensureToolPolicyCollection: async () => undefined,
}));

import { ensureSystemCollections, seedApiCatalog, SEEDED_APIS } from '$lib/selfimprove/seed-apis';
import { ensureIntegrationsCollection } from './integrations';
import { apiRegistryDisabled } from './registry-enabled';

const ORIGINAL = process.env.API_REGISTRY_DISABLED;

beforeEach(() => {
  ensureCollection.mockClear();
  getRecordByKey.mockClear();
  upsertRecord.mockClear();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.API_REGISTRY_DISABLED;
  else process.env.API_REGISTRY_DISABLED = ORIGINAL;
});

function collectionsTouched(): string[] {
  return ensureCollection.mock.calls.map((c) => String((c as unknown[])[0]));
}

describe('API_REGISTRY_DISABLED', () => {
  it('is off unless the value is exactly "1"', () => {
    delete process.env.API_REGISTRY_DISABLED;
    expect(apiRegistryDisabled()).toBe(false);

    process.env.API_REGISTRY_DISABLED = '0';
    expect(apiRegistryDisabled()).toBe(false);

    // Guards against a truthiness check letting "false"/"" through.
    process.env.API_REGISTRY_DISABLED = 'false';
    expect(apiRegistryDisabled()).toBe(false);

    process.env.API_REGISTRY_DISABLED = '1';
    expect(apiRegistryDisabled()).toBe(true);
  });

  describe('when set', () => {
    beforeEach(() => {
      process.env.API_REGISTRY_DISABLED = '1';
    });

    it('does not recreate the api_catalog collection, but still creates the engine ones', async () => {
      await ensureSystemCollections();
      const touched = collectionsTouched();

      expect(touched).not.toContain('api_catalog');
      // The rest are engine bookkeeping, wanted on every host.
      expect(touched).toContain('question_insights');
      expect(touched).toContain('improvement_runs');
      expect(touched.length).toBeGreaterThan(0);
    });

    it('seeds no catalogue entries and does not even look for them', async () => {
      await expect(seedApiCatalog()).resolves.toEqual({ seeded: 0, skipped: 0 });
      expect(upsertRecord).not.toHaveBeenCalled();
      // A "skipped" count could otherwise be produced by probing each key.
      expect(getRecordByKey).not.toHaveBeenCalled();
    });

    it('does not recreate the integrations collection on a lazy read', async () => {
      await ensureIntegrationsCollection();
      expect(ensureCollection).not.toHaveBeenCalled();
    });
  });

  describe('when unset (production)', () => {
    beforeEach(() => {
      delete process.env.API_REGISTRY_DISABLED;
    });

    it('creates the api_catalog collection as before', async () => {
      await ensureSystemCollections();
      expect(collectionsTouched()).toContain('api_catalog');
    });

    it('seeds the full catalogue as before', async () => {
      const res = await seedApiCatalog();
      expect(res.seeded).toBe(SEEDED_APIS.length);
      expect(upsertRecord).toHaveBeenCalledTimes(SEEDED_APIS.length);
    });

    it('creates the integrations collection as before', async () => {
      await ensureIntegrationsCollection();
      expect(ensureCollection).toHaveBeenCalledTimes(1);
    });
  });
});
