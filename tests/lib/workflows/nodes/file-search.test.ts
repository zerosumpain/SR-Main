import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the /drive index lib so no db / embedding call happens.
const { searchFilesMock } = vi.hoisted(() => ({ searchFilesMock: vi.fn() }));
vi.mock('$lib/file-index/search', () => ({ searchFiles: searchFilesMock }));

import { fileSearchExecutor } from '$lib/workflows/nodes/file-search';
import type { ExecutionContext } from '$lib/workflows/types';

function makeCtx(overrides: Record<string, unknown> = {}): ExecutionContext {
  return {
    runId: 'r1',
    workflowId: 'w1',
    workspaceDir: '/tmp',
    dryRun: false,
    emit: vi.fn(),
    getNodeOutput: () => undefined,
    checkBreakpoint: async () => {},
    abortSignal: new AbortController().signal,
    getOutgoingEdges: () => [],
    getIncomingEdges: () => [],
    getNodeConfig: () => undefined,
    _currentNodeId: 'fs-1',
    ...overrides,
  } as unknown as ExecutionContext;
}

const hit = (over: Partial<Record<string, unknown>> = {}) => ({
  fileId: 'f1',
  source: 'report.md',
  modality: 'text',
  chunkOrd: 0,
  charStart: 0,
  charEnd: 10,
  passage: 'a passage',
  score: 0.8,
  ...over,
});

beforeEach(() => {
  searchFilesMock.mockReset();
});

describe('file-search executor', () => {
  it('empty query → throws', async () => {
    await expect(fileSearchExecutor.execute({}, { query: '' }, makeCtx())).rejects.toThrow(/query is required/i);
  });

  it('interpolates {{input.*}} into the query and passes topK through', async () => {
    searchFilesMock.mockResolvedValue([hit()]);
    const res = await fileSearchExecutor.execute(
      { topic: 'refund policy' },
      { query: '{{input.topic}}', topK: 3 },
      makeCtx(),
    );
    expect(searchFilesMock).toHaveBeenCalledWith('refund policy', { topK: 3 });
    expect(res.output).toMatchObject({ query: 'refund policy', count: 1 });
    expect((res.output.results as unknown[])[0]).toEqual({
      fileId: 'f1',
      fileName: 'report.md',
      snippet: 'a passage',
      score: 0.8,
      modality: 'text',
      chunkOrd: 0,
    });
    expect(res.rowCount).toBe(1);
  });

  it('clamps a non-numeric topK to the default', async () => {
    searchFilesMock.mockResolvedValue([]);
    await fileSearchExecutor.execute({}, { query: 'x', topK: 'lots' }, makeCtx());
    expect(searchFilesMock).toHaveBeenCalledWith('x', { topK: 5 });
  });

  it('modality filter over-fetches, filters, and slices to topK', async () => {
    searchFilesMock.mockResolvedValue([
      hit({ fileId: 'a', modality: 'text' }),
      hit({ fileId: 'b', modality: 'image' }),
      hit({ fileId: 'c', modality: 'image' }),
    ]);
    const res = await fileSearchExecutor.execute({}, { query: 'garden', topK: 1, fileTypes: 'image' }, makeCtx());
    // over-fetch: topK*4 = 4
    expect(searchFilesMock).toHaveBeenCalledWith('garden', { topK: 4 });
    const results = res.output.results as { fileId: string; modality: string }[];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ fileId: 'b', modality: 'image' });
  });
});
