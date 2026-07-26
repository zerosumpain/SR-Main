import { describe, it, expect, vi, beforeEach } from 'vitest';

// loop.ts dynamically imports the sub-workflow helpers inside its subworkflow
// branch. Mock that module so no DB / engine is touched.
const { mockLoad, mockRun } = vi.hoisted(() => ({
  mockLoad: vi.fn(),
  mockRun: vi.fn(),
}));

vi.mock('$lib/workflows/nodes/sub-workflow', () => ({
  loadSubWorkflowDefinition: mockLoad,
  runSubWorkflowDefinition: mockRun,
}));

import { loopExecutor } from '$lib/workflows/nodes/loop';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

const fakeDef = { id: 'sub-wf', name: 'Sub', nodes: [], edges: [] };

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return makeExecutionContext({
    runId: 'test-run',
    workflowId: 'parent-wf',
    workspaceDir: '/tmp',
    ...overrides,
  });
}

type ItemResult = { index: number; status: 'succeeded' | 'failed'; output?: unknown; error?: string };
const asResults = (out: Record<string, unknown>) => out.results as ItemResult[];

function items(n: number) {
  return Array.from({ length: n }, (_, i) => ({ v: i }));
}

describe('loop — subworkflow mode', () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockRun.mockReset();
    mockLoad.mockResolvedValue(fakeDef);
    mockRun.mockResolvedValue({ status: 'completed', output: {}, subRunId: 'r' });
  });

  it('invokes the sub-workflow per item with { item, index } and collects results', async () => {
    mockRun.mockImplementation(async (_def, input) => ({
      status: 'completed',
      output: { got: (input as { index: number }).index },
      subRunId: 'r',
    }));

    const res = await loopExecutor.execute(
      { rows: items(3) },
      { mode: 'subworkflow', arrayPath: 'rows', subWorkflowId: 'sub-wf', concurrency: 1 },
      makeContext(),
    );

    expect(mockRun).toHaveBeenCalledTimes(3);
    // Confirm per-item input shape.
    expect(mockRun.mock.calls[0][1]).toEqual({ item: { v: 0 }, index: 0 });
    expect(res.output.count).toBe(3);
    expect(res.output.succeeded).toBe(3);
    expect(res.output.failed).toBe(0);
    expect(asResults(res.output)).toEqual([
      { index: 0, status: 'succeeded', output: { got: 0 } },
      { index: 1, status: 'succeeded', output: { got: 1 } },
      { index: 2, status: 'succeeded', output: { got: 2 } },
    ]);
  });

  it('never runs more than `concurrency` items in flight at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockRun.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight--;
      return { status: 'completed', output: {}, subRunId: 'r' };
    });

    const res = await loopExecutor.execute(
      { rows: items(12) },
      { mode: 'subworkflow', arrayPath: 'rows', subWorkflowId: 'sub-wf', concurrency: 3 },
      makeContext(),
    );

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(res.output.count).toBe(12);
    expect(res.output.succeeded).toBe(12);
  });

  it('clamps concurrency to a max of 10', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockRun.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight--;
      return { status: 'completed', output: {}, subRunId: 'r' };
    });

    await loopExecutor.execute(
      { rows: items(30) },
      { mode: 'subworkflow', arrayPath: 'rows', subWorkflowId: 'sub-wf', concurrency: 50 },
      makeContext(),
    );

    expect(maxInFlight).toBeLessThanOrEqual(10);
  });

  it('failurePolicy=continue records failures and keeps processing every item', async () => {
    mockRun.mockImplementation(async (_def, input) => {
      const idx = (input as { index: number }).index;
      if (idx === 1) return { status: 'failed', output: {}, error: 'boom', subRunId: 'r' };
      return { status: 'completed', output: { ok: idx }, subRunId: 'r' };
    });

    const res = await loopExecutor.execute(
      { rows: items(3) },
      { mode: 'subworkflow', arrayPath: 'rows', subWorkflowId: 'sub-wf', concurrency: 1 },
      makeContext(),
    );

    expect(mockRun).toHaveBeenCalledTimes(3);
    expect(res.output.count).toBe(3);
    expect(res.output.failed).toBe(1);
    expect(res.output.succeeded).toBe(2);
    const failed = asResults(res.output).find((r) => r.status === 'failed');
    expect(failed).toEqual({ index: 1, status: 'failed', error: 'boom' });
  });

  it('failurePolicy=continue records a thrown error as a failed item', async () => {
    mockRun.mockImplementation(async (_def, input) => {
      if ((input as { index: number }).index === 0) throw new Error('kaboom');
      return { status: 'completed', output: {}, subRunId: 'r' };
    });

    const res = await loopExecutor.execute(
      { rows: items(2) },
      { mode: 'subworkflow', arrayPath: 'rows', subWorkflowId: 'sub-wf', concurrency: 1 },
      makeContext(),
    );

    expect(res.output.count).toBe(2);
    expect(res.output.failed).toBe(1);
    const failed = asResults(res.output).find((r) => r.status === 'failed');
    expect(failed?.error).toBe('kaboom');
  });

  it('failurePolicy=stop halts on the first failure', async () => {
    mockRun.mockImplementation(async (_def, input) => {
      if ((input as { index: number }).index === 0) {
        return { status: 'failed', output: {}, error: 'x', subRunId: 'r' };
      }
      return { status: 'completed', output: {}, subRunId: 'r' };
    });

    const res = await loopExecutor.execute(
      { rows: items(5) },
      { mode: 'subworkflow', arrayPath: 'rows', subWorkflowId: 'sub-wf', concurrency: 1, failurePolicy: 'stop' },
      makeContext(),
    );

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(res.output.count).toBe(1);
    expect(res.output.failed).toBe(1);
    expect((res.logs ?? []).some((l) => /halted early/i.test(l))).toBe(true);
  });

  it('rejects self-recursion (subWorkflowId === current workflowId) before invoking', async () => {
    const res = await loopExecutor.execute(
      { rows: items(2) },
      { mode: 'subworkflow', arrayPath: 'rows', subWorkflowId: 'parent-wf' },
      makeContext({ workflowId: 'parent-wf' }),
    );

    expect(res.output.error).toMatch(/self-recursion/i);
    expect(mockLoad).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('dryRun does not invoke sub-workflows and reports wouldProcess', async () => {
    const res = await loopExecutor.execute(
      { rows: items(4) },
      { mode: 'subworkflow', arrayPath: 'rows', subWorkflowId: 'sub-wf' },
      makeContext({ dryRun: true }),
    );

    expect(res.output).toEqual({ results: [], dryRun: true, wouldProcess: 4 });
    expect(mockLoad).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('honours the abort signal mid-pool', async () => {
    const ac = new AbortController();
    let calls = 0;
    mockRun.mockImplementation(async (_def, input) => {
      calls++;
      if (calls >= 2) ac.abort();
      return { status: 'completed', output: { i: (input as { index: number }).index }, subRunId: 'r' };
    });

    const res = await loopExecutor.execute(
      { rows: items(10) },
      { mode: 'subworkflow', arrayPath: 'rows', subWorkflowId: 'sub-wf', concurrency: 1 },
      makeContext({ abortSignal: ac.signal }),
    );

    expect((res.output.count as number)).toBeLessThan(10);
    expect(mockRun.mock.calls.length).toBeLessThan(10);
    expect((res.logs ?? []).some((l) => /abort/i.test(l))).toBe(true);
  });

  it('truncates to maxItems and logs the truncation', async () => {
    const res = await loopExecutor.execute(
      { rows: items(5) },
      { mode: 'subworkflow', arrayPath: 'rows', subWorkflowId: 'sub-wf', maxItems: 3, concurrency: 2 },
      makeContext(),
    );

    expect(mockRun).toHaveBeenCalledTimes(3);
    expect(res.output.count).toBe(3);
    expect(res.output.truncated).toBe(true);
    expect(res.output.totalItems).toBe(5);
    expect((res.logs ?? []).some((l) => /truncat/i.test(l))).toBe(true);
  });

  it('errors when the array path is not an array', async () => {
    const res = await loopExecutor.execute(
      { rows: 'nope' },
      { mode: 'subworkflow', arrayPath: 'rows', subWorkflowId: 'sub-wf' },
      makeContext(),
    );
    expect(res.output).toEqual({ error: 'Not an array', path: 'rows' });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('errors when no subWorkflowId is configured', async () => {
    const res = await loopExecutor.execute(
      { rows: items(2) },
      { mode: 'subworkflow', arrayPath: 'rows' },
      makeContext(),
    );
    expect(res.output.error).toMatch(/no subworkflowid/i);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('errors when the sub-workflow id does not resolve', async () => {
    mockLoad.mockResolvedValue(null);
    const res = await loopExecutor.execute(
      { rows: items(2) },
      { mode: 'subworkflow', arrayPath: 'rows', subWorkflowId: 'ghost' },
      makeContext(),
    );
    expect(res.output.error).toMatch(/not found/i);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe('loop — map mode is untouched by subworkflow additions', () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockRun.mockReset();
  });

  it('mode:map returns { results, count } and never touches sub-workflow helpers', async () => {
    const res = await loopExecutor.execute(
      { items: [1, 2, 3] },
      { mode: 'map', arrayPath: 'items', expression: 'return item * 2' },
      makeContext(),
    );
    expect(res.output).toEqual({ results: [2, 4, 6], count: 3 });
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('unset mode defaults to map (no extra output keys)', async () => {
    const res = await loopExecutor.execute(
      { items: [1, 2, 3] },
      { arrayPath: 'items', expression: 'return item + 1' },
      makeContext(),
    );
    expect(res.output).toEqual({ results: [2, 3, 4], count: 3 });
    expect(mockRun).not.toHaveBeenCalled();
  });
});
