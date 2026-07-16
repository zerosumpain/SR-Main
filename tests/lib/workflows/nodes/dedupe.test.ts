import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';

// Mock the data-store boundary: dedupe reads the seen-set via getStoreValue and
// records via addToSetAtomic. Spying these lets us assert filter + record
// behaviour without a database.
const mockGetStoreValue = vi.fn();
const mockAddToSetAtomic = vi.fn();

vi.mock('$lib/workflows/nodes/data-store', () => ({
  getStoreValue: mockGetStoreValue,
  addToSetAtomic: mockAddToSetAtomic,
}));

const {
  dedupeExecutor,
  dedupeDef,
  flushPendingDedupeRecords,
  discardPendingDedupeRecords,
} = await import('$lib/workflows/nodes/dedupe');

function ctx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    workspaceDir: '/tmp',
    dryRun: false,
    emit: () => {},
    getNodeOutput: () => undefined,
    checkBreakpoint: async () => {},
    abortSignal: new AbortController().signal,
    getOutgoingEdges: () => [],
    getIncomingEdges: () => [],
    getNodeConfig: () => undefined,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetStoreValue.mockResolvedValue({ value: [], found: false });
  mockAddToSetAtomic.mockResolvedValue([]);
});

describe('dedupeExecutor', () => {
  it('filters out already-seen items by url and records the new ones (immediate)', async () => {
    mockGetStoreValue.mockResolvedValue({ value: ['a'], found: true });
    const result = await dedupeExecutor.execute(
      { results: [{ url: 'a' }, { url: 'b' }] },
      { itemsPath: 'results', idPath: 'url', storeKey: 'seen_urls', maxRemembered: 500 },
      ctx(),
    );
    expect(result.output.items).toEqual([{ url: 'b' }]);
    expect(result.output.newCount).toBe(1);
    expect(result.output.seenCount).toBe(1);
    expect(result.output.allItems).toEqual([{ url: 'a' }, { url: 'b' }]);
    // Only the genuinely-new id is recorded.
    expect(mockAddToSetAtomic).toHaveBeenCalledWith('wf-1', 'seen_urls', ['b'], 500);
  });

  it('passes through other top-level input keys and drops the items-source key', async () => {
    const result = await dedupeExecutor.execute(
      { results: [{ url: 'a' }], query: 'news', responseTime: 12 },
      { itemsPath: 'results', idPath: 'url' },
      ctx(),
    );
    // Other keys preserved; the raw `results` array is not re-emitted under its
    // original key (available as allItems instead).
    expect(result.output.query).toBe('news');
    expect(result.output.responseTime).toBe(12);
    expect(result.output.results).toBeUndefined();
    expect(result.output.items).toEqual([{ url: 'a' }]);
  });

  it('auto-detects the first array when itemsPath is empty', async () => {
    const result = await dedupeExecutor.execute(
      { articles: [{ url: 'x' }, { url: 'y' }] },
      { idPath: 'url' },
      ctx(),
    );
    expect(result.output.newCount).toBe(2);
    expect(result.output.allItems).toEqual([{ url: 'x' }, { url: 'y' }]);
  });

  it('falls back to url then id when idPath is not set', async () => {
    mockGetStoreValue.mockResolvedValue({ value: ['keep-me'], found: true });
    const result = await dedupeExecutor.execute(
      { results: [{ id: 'keep-me' }, { id: 'new-one' }] },
      { itemsPath: 'results' },
      ctx(),
    );
    expect(result.output.items).toEqual([{ id: 'new-one' }]);
    expect(mockAddToSetAtomic).toHaveBeenCalledWith('wf-1', 'seen_ids', ['new-one'], 500);
  });

  it('passes items with no id through as new but does not store an undefined id', async () => {
    const result = await dedupeExecutor.execute(
      { results: [{ url: 'a' }, { title: 'no id here' }] },
      { itemsPath: 'results', idPath: 'url' },
      ctx(),
    );
    expect(result.output.items).toHaveLength(2); // both new
    expect(result.output.newCount).toBe(2);
    // Only the item with a resolvable id is remembered.
    expect(mockAddToSetAtomic).toHaveBeenCalledWith('wf-1', 'seen_ids', ['a'], 500);
  });

  it('coerces ids to strings when matching the stored set', async () => {
    mockGetStoreValue.mockResolvedValue({ value: ['1'], found: true }); // stored as strings
    const result = await dedupeExecutor.execute(
      { results: [{ id: 1 }, { id: 2 }] },
      { itemsPath: 'results', idPath: 'id' },
      ctx(),
    );
    expect(result.output.items).toEqual([{ id: 2 }]);
    expect(mockAddToSetAtomic).toHaveBeenCalledWith('wf-1', 'seen_ids', ['2'], 500);
  });

  it('dryRun filters but never records', async () => {
    const result = await dedupeExecutor.execute(
      { results: [{ url: 'a' }] },
      { itemsPath: 'results', idPath: 'url' },
      ctx({ dryRun: true }),
    );
    expect(result.output.items).toEqual([{ url: 'a' }]);
    expect(result.output.dryRun).toBe(true);
    expect(mockAddToSetAtomic).not.toHaveBeenCalled();
  });

  it('records nothing when there are no new items', async () => {
    mockGetStoreValue.mockResolvedValue({ value: ['a'], found: true });
    const result = await dedupeExecutor.execute(
      { results: [{ url: 'a' }] },
      { itemsPath: 'results', idPath: 'url' },
      ctx(),
    );
    expect(result.output.newCount).toBe(0);
    expect(mockAddToSetAtomic).not.toHaveBeenCalled();
  });

  describe('recordMode: downstream-success', () => {
    it('defers recording until the run flush', async () => {
      const runId = 'run-defer';
      await dedupeExecutor.execute(
        { results: [{ url: 'a' }, { url: 'b' }] },
        { itemsPath: 'results', idPath: 'url', storeKey: 'sent', recordMode: 'downstream-success' },
        ctx({ runId }),
      );
      // Nothing written yet.
      expect(mockAddToSetAtomic).not.toHaveBeenCalled();

      // Flush on run success commits the deferred ids.
      await flushPendingDedupeRecords(runId);
      expect(mockAddToSetAtomic).toHaveBeenCalledWith('wf-1', 'sent', ['a', 'b'], 500);
    });

    it('discards deferred records on failure — nothing is stored', async () => {
      const runId = 'run-discard';
      await dedupeExecutor.execute(
        { results: [{ url: 'a' }] },
        { itemsPath: 'results', idPath: 'url', recordMode: 'downstream-success' },
        ctx({ runId }),
      );
      discardPendingDedupeRecords(runId);
      await flushPendingDedupeRecords(runId); // no-op now
      expect(mockAddToSetAtomic).not.toHaveBeenCalled();
    });
  });
});

describe('dedupeDef', () => {
  it('is core category with one input and one output', () => {
    expect(dedupeDef.category).toBe('core');
    expect(dedupeDef.inputs).toHaveLength(1);
    expect(dedupeDef.outputs).toHaveLength(1);
  });

  it('has an llmExample for tavily-style results (url / results)', () => {
    const serialised = JSON.stringify(dedupeDef.llmExamples ?? []);
    expect(serialised).toMatch(/"idPath":"url"/);
    expect(serialised).toMatch(/"itemsPath":"results"/);
  });

  it('summarize names the seen-set key', () => {
    const s = dedupeDef.summarize?.({ storeKey: 'seen_urls' });
    expect(s?.line).toMatch(/seen_urls/);
  });
});
