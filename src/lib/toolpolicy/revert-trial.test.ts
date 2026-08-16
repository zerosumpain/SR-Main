import { describe, it, expect, beforeEach, vi } from 'vitest';

// An in-memory stand-in for the datastore, so the revert path can be exercised
// for real rather than asserted about. `policy.test.ts` covers only the pure
// helpers; this is the one behaviour that writes.
const store = new Map<string, Record<string, unknown>>();

vi.mock('$lib/datastore', () => ({
  DatastoreError: class DatastoreError extends Error { code = 'not_found'; },
  ensureCollection: vi.fn(async () => {}),
  getCollectionBySlug: vi.fn(async () => ({ slug: 'tool_call_policy' })),
  getRecordByKey: vi.fn(async (_c: string, key: string) => {
    const data = store.get(key);
    if (!data) { const e = new Error('not found') as Error & { code: string }; e.code = 'not_found'; throw e; }
    return { key, data };
  }),
  queryRecords: vi.fn(async () => ({
    records: [...store.entries()].filter(([k]) => k.startsWith('v:')).map(([key, data]) => ({ key, data })),
  })),
  upsertRecord: vi.fn(async (_c: string, rec: { key: string; data: Record<string, unknown> }) => {
    store.set(rec.key, rec.data);
  }),
}));

import { publishPolicy, revertPolicyTo, getPolicyVersion, invalidateToolPolicyCache } from './policy';

beforeEach(() => { store.clear(); invalidateToolPolicyCache(); });

describe('reverting a trial by hand closes it', () => {
  it('marks the abandoned version reverted instead of leaving it "running"', async () => {
    const baseline = { meanCalls: 2.7, turns: 500, repeatCalls: 700, takenAt: '2026-08-16T09:00:00.000Z' };
    const v1 = await publishPolicy({
      rationale: 'promote six tools',
      promoteToEssential: ['ha_query_state'],
      createdBy: 'owner',
      baseline,
    });
    expect(v1.trial?.status).toBe('running');
    invalidateToolPolicyCache();

    await revertPolicyTo(0, 'changed my mind', 'owner');

    // `assessActiveTrial` is the only other writer of a verdict and it looks
    // solely at the ACTIVE policy — so without this the ledger showed a trial
    // that had in fact been cancelled, for good.
    const closed = await getPolicyVersion(v1.version);
    expect(closed?.trial?.status).toBe('reverted');
    expect(closed?.trial?.verdict).toMatch(/cancelled by owner/i);
    expect(closed?.trial?.decidedAt).toBeTruthy();
  });

  it('leaves a version with no trial alone', async () => {
    await publishPolicy({ rationale: 'no trial', globalGuidance: ['x'], createdBy: 'owner' });
    invalidateToolPolicyCache();
    // Must not throw, and must still publish the revert.
    const reverted = await revertPolicyTo(0, 'tidy up', 'owner');
    expect(reverted?.promoteToEssential).toEqual([]);
  });
});
