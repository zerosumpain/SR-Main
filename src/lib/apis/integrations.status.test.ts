// A register row's `status` is written by jkai as well as by the register, and
// jkai has written the api_catalog word "candidate" into it — a value the
// union does not have. It then renders unstyled in both the admin register and
// the api-integration node panel, and never matches a "verified" filter. Fold
// it back on read so one bad write costs nothing downstream.

import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/datastore', () => ({
  DatastoreError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  ensureCollection: async () => undefined,
  getRecordByKey: async () => {
    throw new Error('not used');
  },
  queryRecords: async () => ({
    records: [
      { key: 'paypal-transactions', data: { name: 'PayPal transactions', status: 'candidate' } },
      { key: 'truelayer-accounts', data: { name: 'TrueLayer accounts', status: 'verified' } },
      { key: 'openrouter-credits', data: { name: 'OpenRouter credits' } },
      { key: 'broken-one', data: { name: 'Broken', status: 'broken' } },
    ],
  }),
  upsertRecord: async () => ({ id: 'rec' }),
  deleteRecord: async () => true,
  updateRecord: async () => ({ id: 'rec' }),
}));

import { listIntegrations } from './integrations';

describe('integration status normalisation', () => {
  it('folds an out-of-union status back to draft and leaves real ones alone', async () => {
    const byKey = new Map((await listIntegrations()).map((i) => [i.key, i.status]));

    expect(byKey.get('paypal-transactions')).toBe('draft');
    expect(byKey.get('openrouter-credits')).toBe('draft');
    expect(byKey.get('truelayer-accounts')).toBe('verified');
    expect(byKey.get('broken-one')).toBe('broken');
  });
});
