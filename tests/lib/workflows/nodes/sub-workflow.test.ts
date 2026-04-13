import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subWorkflowExecutor, subWorkflowDef } from '$lib/workflows/nodes/sub-workflow';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: 'parent-wf',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

describe('subWorkflowExecutor', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ runId: 'sub-run-1', status: 'completed', output: { result: 'sub-workflow output' } }),
      text: () => Promise.resolve(''),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls another workflow and returns its output', async () => {
    const result = await subWorkflowExecutor.execute(
      { data: 'hello' },
      { workflowId: 'wf-abc-123' },
      mockContext,
    );

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:5173/api/workflows/wf-abc-123/run',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { data: 'hello' }, waitForCompletion: true }),
      }),
    );
    expect(result.output).toEqual({ result: 'sub-workflow output' });
    expect(result.metadata).toEqual({ subRunId: 'sub-run-1', subWorkflowId: 'wf-abc-123' });
  });

  it('returns error when workflowId is empty', async () => {
    const result = await subWorkflowExecutor.execute(
      { data: 'hello' },
      { workflowId: '' },
      mockContext,
    );

    expect(result.output).toEqual({ error: 'No workflowId configured' });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('returns error when workflowId is not configured', async () => {
    const result = await subWorkflowExecutor.execute(
      {},
      {},
      mockContext,
    );

    expect(result.output).toEqual({ error: 'No workflowId configured' });
  });

  it('returns error when fetch fails (ok: false)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('Internal Server Error'),
    } as any);

    const result = await subWorkflowExecutor.execute(
      {},
      { workflowId: 'wf-failing' },
      mockContext,
    );

    expect(result.output).toEqual({ error: 'Sub-workflow failed: Internal Server Error' });
  });

  it('has correct type', () => {
    expect(subWorkflowExecutor.type).toBe('sub-workflow');
  });
});

describe('subWorkflowDef', () => {
  it('is control category', () => {
    expect(subWorkflowDef.category).toBe('control');
  });

  it('has workflowId in configSchema', () => {
    expect(subWorkflowDef.configSchema.properties?.workflowId).toBeDefined();
  });

  it('requires workflowId', () => {
    expect(subWorkflowDef.configSchema.required).toContain('workflowId');
  });

  it('has one input and one output', () => {
    expect(subWorkflowDef.inputs).toHaveLength(1);
    expect(subWorkflowDef.outputs).toHaveLength(1);
  });
});
