import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

// Mock the data-store boundary. dedupe now decides "which ids are new" via the
// ATOMIC claim (addToSetReturningNew) in immediate mode, defers via an embedded
// output record in downstream-success mode, and only touches getStoreValue for
// the (read-only) dry-run + downstream-success filter. Spying these lets us
// assert filter + record behaviour without a database.
const mockGetStoreValue = vi.fn();
const mockAddToSetAtomic = vi.fn();
const mockAddToSetReturningNew = vi.fn();

vi.mock('$lib/workflows/nodes/data-store', () => ({
  getStoreValue: mockGetStoreValue,
  addToSetAtomic: mockAddToSetAtomic,
  addToSetReturningNew: mockAddToSetReturningNew,
}));

const {
  dedupeExecutor,
  dedupeDef,
  commitDeferredDedupeRecords,
  PENDING_DEDUPE_KEY,
} = await import('$lib/workflows/nodes/dedupe');

function ctx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return makeExecutionContext({
    runId: 'run-1',
    workflowId: 'wf-1',
    workspaceDir: '/tmp',
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetStoreValue.mockResolvedValue({ value: [], found: false });
  mockAddToSetAtomic.mockResolvedValue([]);
  // Default: the atomic claim treats every candidate as new (empty stored set).
  mockAddToSetReturningNew.mockImplementation(async (_wf, _key, ids) => ids);
});

describe('dedupeExecutor (immediate mode — atomic claim)', () => {
  it('emits + records only the ids the atomic claim returned as new', async () => {
    // Model a concurrent run having already claimed "a": the atomic op returns
    // only "b" even though this node passed both candidates in.
    mockAddToSetReturningNew.mockResolvedValue(['b']);
    const result = await dedupeExecutor.execute(
      { results: [{ url: 'a' }, { url: 'b' }] },
      { itemsPath: 'results', idPath: 'url', storeKey: 'seen_urls', maxRemembered: 500 },
      ctx(),
    );
    expect(result.output.items).toEqual([{ url: 'b' }]);
    expect(result.output.newCount).toBe(1);
    expect(result.output.seenCount).toBe(1);
    expect(result.output.allItems).toEqual([{ url: 'a' }, { url: 'b' }]);
    // The claim (not a stale getStoreValue read) is the authority on newness.
    expect(mockAddToSetReturningNew).toHaveBeenCalledWith('wf-1', 'seen_urls', ['a', 'b'], 500);
    expect(mockAddToSetAtomic).not.toHaveBeenCalled();
  });

  it('does not consult the stale getStoreValue read to decide newness', async () => {
    // Stale read is empty (would pass both), but the atomic op claims only "b".
    mockGetStoreValue.mockResolvedValue({ value: [], found: false });
    mockAddToSetReturningNew.mockResolvedValue(['b']);
    const result = await dedupeExecutor.execute(
      { results: [{ url: 'a' }, { url: 'b' }] },
      { itemsPath: 'results', idPath: 'url', storeKey: 'seen' },
      ctx(),
    );
    expect(result.output.items).toEqual([{ url: 'b' }]);
    expect(mockGetStoreValue).not.toHaveBeenCalled();
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
    mockAddToSetReturningNew.mockResolvedValue(['new-one']);
    const result = await dedupeExecutor.execute(
      { results: [{ id: 'keep-me' }, { id: 'new-one' }] },
      { itemsPath: 'results' },
      ctx(),
    );
    expect(result.output.items).toEqual([{ id: 'new-one' }]);
    expect(mockAddToSetReturningNew).toHaveBeenCalledWith('wf-1', 'seen_ids', ['keep-me', 'new-one'], 500);
  });

  it('passes items with no id through as new but does not store an undefined id', async () => {
    mockAddToSetReturningNew.mockResolvedValue(['a']);
    const result = await dedupeExecutor.execute(
      { results: [{ url: 'a' }, { title: 'no id here' }] },
      { itemsPath: 'results', idPath: 'url' },
      ctx(),
    );
    expect(result.output.items).toHaveLength(2); // both new (one via id, one id-less)
    expect(result.output.newCount).toBe(2);
    // Only the item with a resolvable id is put through the claim.
    expect(mockAddToSetReturningNew).toHaveBeenCalledWith('wf-1', 'seen_ids', ['a'], 500);
  });

  it('coerces candidate ids to strings before the atomic claim', async () => {
    mockAddToSetReturningNew.mockResolvedValue(['2']);
    const result = await dedupeExecutor.execute(
      { results: [{ id: 1 }, { id: 2 }] },
      { itemsPath: 'results', idPath: 'id' },
      ctx(),
    );
    expect(result.output.items).toEqual([{ id: 2 }]);
    expect(mockAddToSetReturningNew).toHaveBeenCalledWith('wf-1', 'seen_ids', ['1', '2'], 500);
  });

  it('dryRun filters against the stored set but never writes', async () => {
    mockGetStoreValue.mockResolvedValue({ value: [], found: false });
    const result = await dedupeExecutor.execute(
      { results: [{ url: 'a' }] },
      { itemsPath: 'results', idPath: 'url' },
      ctx({ dryRun: true }),
    );
    expect(result.output.items).toEqual([{ url: 'a' }]);
    expect(result.output.dryRun).toBe(true);
    expect(mockGetStoreValue).toHaveBeenCalled();
    expect(mockAddToSetReturningNew).not.toHaveBeenCalled();
    expect(mockAddToSetAtomic).not.toHaveBeenCalled();
  });

  it('records nothing new when the atomic claim returns no ids', async () => {
    mockAddToSetReturningNew.mockResolvedValue([]);
    const result = await dedupeExecutor.execute(
      { results: [{ url: 'a' }] },
      { itemsPath: 'results', idPath: 'url' },
      ctx(),
    );
    expect(result.output.newCount).toBe(0);
    expect(result.output.items).toEqual([]);
  });

  describe('recordMode: downstream-success (durable deferred record)', () => {
    it('embeds a durable deferred record in the output instead of writing immediately', async () => {
      const result = await dedupeExecutor.execute(
        { results: [{ url: 'a' }, { url: 'b' }] },
        { itemsPath: 'results', idPath: 'url', storeKey: 'sent', recordMode: 'downstream-success' },
        ctx({ runId: 'run-defer' }),
      );
      // Nothing written yet — neither the atomic claim nor an immediate append.
      expect(mockAddToSetReturningNew).not.toHaveBeenCalled();
      expect(mockAddToSetAtomic).not.toHaveBeenCalled();
      // The deferred record travels in the node output (durable across pause/resume).
      expect(result.output[PENDING_DEDUPE_KEY]).toEqual({
        workflowId: 'wf-1', storeKey: 'sent', ids: ['a', 'b'], maxRemembered: 500,
      });
      expect(result.output.items).toEqual([{ url: 'a' }, { url: 'b' }]);

      // The engine commits on overall run success by scanning the node outputs.
      await commitDeferredDedupeRecords([result.output]);
      expect(mockAddToSetAtomic).toHaveBeenCalledWith('wf-1', 'sent', ['a', 'b'], 500);
    });

    it('a failed run never commits the deferred record — nothing is stored', async () => {
      const result = await dedupeExecutor.execute(
        { results: [{ url: 'a' }] },
        { itemsPath: 'results', idPath: 'url', recordMode: 'downstream-success' },
        ctx({ runId: 'run-fail' }),
      );
      expect(result.output[PENDING_DEDUPE_KEY]).toMatchObject({ ids: ['a'] });
      // On failure the engine simply does NOT call commit → nothing stored.
      expect(mockAddToSetAtomic).not.toHaveBeenCalled();
    });

    it('deferred record survives an awaiting_human pause that resumes in another process', async () => {
      // The dedupe node runs in the original process and produces an output; the
      // run pauses; a DIFFERENT process re-seeds that persisted output and
      // completes. commit must still fire with no shared module state — proven by
      // JSON round-tripping the output (models DB persist + resume re-seed).
      const { output } = await dedupeExecutor.execute(
        { results: [{ url: 'story-1' }] },
        { itemsPath: 'results', idPath: 'url', storeKey: 'sent_stories', recordMode: 'downstream-success' },
        ctx({ runId: 'run-A' }),
      );
      const reseeded = JSON.parse(JSON.stringify(output)) as Record<string, unknown>;
      await commitDeferredDedupeRecords([reseeded]);
      expect(mockAddToSetAtomic).toHaveBeenCalledWith('wf-1', 'sent_stories', ['story-1'], 500);
    });

    it('commit is a no-op for outputs with no deferred record', async () => {
      await commitDeferredDedupeRecords([{ items: [] }, undefined, { [PENDING_DEDUPE_KEY]: { ids: [] } }]);
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
