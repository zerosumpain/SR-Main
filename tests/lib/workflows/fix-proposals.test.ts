import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for the datastore: one collection, keyed records. Enough
// to exercise the dedupe / sticky-verdict rules without touching the dev DB.
const store = vi.hoisted(() => ({
  collections: new Set<string>(),
  records: new Map<string, { key: string; id: string; data: Record<string, unknown>; updatedAt: number }>(),
  tick: 0,
}));

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
    ensureCollection: vi.fn(async (slug: string) => {
      store.collections.add(slug);
      return { slug };
    }),
    getCollectionBySlug: vi.fn(async (slug: string) => (store.collections.has(slug) ? { slug } : null)),
    getRecordByKey: vi.fn(async (_slug: string, key: string) => {
      const r = store.records.get(key);
      if (!r) throw new DatastoreError('not_found', 'nope');
      return r;
    }),
    upsertRecord: vi.fn(async (_slug: string, input: { key: string; data: Record<string, unknown> }) => {
      const rec = { key: input.key, id: input.key, data: structuredClone(input.data), updatedAt: ++store.tick };
      store.records.set(input.key, rec);
      return rec;
    }),
    queryRecords: vi.fn(async (_slug: string, opts: { filters?: Array<{ path: string; value: unknown }> }) => {
      const records = [...store.records.values()]
        .filter((r) => (opts.filters ?? []).every((f) => r.data[f.path] === f.value))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { records };
    }),
  };
});

const applyAmendOps = vi.hoisted(() => vi.fn());
vi.mock('$lib/canvas/amend.server', () => ({ applyAmendOps }));

import {
  recordFixProposalsFromHealing,
  listFixProposals,
  acceptFixProposal,
  dismissFixProposal,
  diffConfigs,
  FixProposalNotFoundError,
  FixProposalNotPendingError,
} from '$lib/workflows/fix-proposals.server';
import type { UndoEntry } from '$lib/workflows/types';

function entry(over: Partial<UndoEntry> = {}): UndoEntry {
  return {
    id: 'u1',
    runId: 'run-1',
    nodeId: 'node-A',
    attempt: 1,
    timestamp: new Date().toISOString(),
    originalConfig: { url: 'http://x', method: 'GET' },
    newConfig: { url: 'https://x', method: 'GET' },
    fixDescription: 'use https',
    nodeLabel: 'Fetch',
    nodeType: 'http-request',
    retrySucceeded: true,
    ...over,
  };
}

beforeEach(() => {
  store.collections.clear();
  store.records.clear();
  applyAmendOps.mockReset();
  applyAmendOps.mockResolvedValue({ workflowId: 'wf-1', outcomes: [{ op: 'update_node', summary: 'ok' }] });
});

describe('fix proposals', () => {
  it('only a heal whose retry succeeded becomes a proposal', async () => {
    const n = await recordFixProposalsFromHealing('wf-1', 'run-1', [
      entry({ id: 'a', attempt: 1, retrySucceeded: undefined, newConfig: { url: 'ftp://x', method: 'GET' } }),
      entry({ id: 'b', attempt: 2, originalConfig: { url: 'ftp://x', method: 'GET' } }),
    ]);
    expect(n).toBe(1);
    const list = await listFixProposals('wf-1');
    expect(list).toHaveLength(1);
    // Diffed against the SAVED config (attempt 1's original), not attempt 2's.
    expect(list[0]).toMatchObject({
      nodeId: 'node-A',
      nodeLabel: 'Fetch',
      status: 'pending',
      runId: 'run-1',
      changes: { url: 'https://x' },
      previous: { url: 'http://x' },
    });
  });

  it('the same node + same proposed config is ONE pending proposal, not two', async () => {
    await recordFixProposalsFromHealing('wf-1', 'run-1', [entry()]);
    await recordFixProposalsFromHealing('wf-1', 'run-2', [entry({ runId: 'run-2' })]);
    const list = await listFixProposals('wf-1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ occurrences: 2, runId: 'run-2' });
  });

  it('a different proposed config for the same node is a separate proposal', async () => {
    await recordFixProposalsFromHealing('wf-1', 'run-1', [entry()]);
    await recordFixProposalsFromHealing('wf-1', 'run-2', [
      entry({ newConfig: { url: 'https://y', method: 'GET' } }),
    ]);
    expect(await listFixProposals('wf-1')).toHaveLength(2);
  });

  it('a dismissed fix is not proposed again', async () => {
    await recordFixProposalsFromHealing('wf-1', 'run-1', [entry()]);
    const [p] = await listFixProposals('wf-1');
    await dismissFixProposal('wf-1', p.id);
    await recordFixProposalsFromHealing('wf-1', 'run-2', [entry()]);
    expect(await listFixProposals('wf-1')).toHaveLength(0);
    expect(await listFixProposals('wf-1', { status: 'dismissed' })).toHaveLength(1);
  });

  it('accept applies through applyAmendOps update_node as the owner', async () => {
    await recordFixProposalsFromHealing('wf-1', 'run-1', [entry()]);
    const [p] = await listFixProposals('wf-1');
    const res = await acceptFixProposal('wf-1', p.id);
    expect(applyAmendOps).toHaveBeenCalledTimes(1);
    expect(applyAmendOps).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        actor: 'owner',
        ops: [{ op: 'update_node', nodeId: 'node-A', config: { url: 'https://x' } }],
      }),
    );
    expect(res.proposal.status).toBe('accepted');
    expect(await listFixProposals('wf-1')).toHaveLength(0);
  });

  it('accept does not mark the proposal accepted when the amend throws', async () => {
    await recordFixProposalsFromHealing('wf-1', 'run-1', [entry()]);
    const [p] = await listFixProposals('wf-1');
    applyAmendOps.mockRejectedValueOnce(new Error('node gone'));
    await expect(acceptFixProposal('wf-1', p.id)).rejects.toThrow(/node gone/);
    expect((await listFixProposals('wf-1'))[0].status).toBe('pending');
  });

  it('a proposal is scoped to its workflow, and cannot be resolved twice', async () => {
    await recordFixProposalsFromHealing('wf-1', 'run-1', [entry()]);
    const [p] = await listFixProposals('wf-1');
    await expect(acceptFixProposal('wf-OTHER', p.id)).rejects.toBeInstanceOf(FixProposalNotFoundError);
    await dismissFixProposal('wf-1', p.id);
    await expect(acceptFixProposal('wf-1', p.id)).rejects.toBeInstanceOf(FixProposalNotPendingError);
    expect(applyAmendOps).not.toHaveBeenCalled();
  });

  it('a node whose config holds a credential is never proposed', async () => {
    const n = await recordFixProposalsFromHealing('wf-1', 'run-1', [
      entry({
        originalConfig: { apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD' },
        newConfig: { apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD', retries: 2 },
      }),
    ]);
    expect(n).toBe(0);
  });

  it('diffConfigs marks a removed key as null', () => {
    expect(diffConfigs({ a: 1, b: 2 }, { a: 1, c: 3 })).toEqual({
      changes: { b: null, c: 3 },
      previous: { b: 2 },
    });
  });
});
