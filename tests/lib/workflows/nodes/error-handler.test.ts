import { describe, it, expect } from 'vitest';
import { errorHandlerExecutor, errorHandlerDef } from '$lib/workflows/nodes/error-handler';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  dryRun: false,
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
} as any;

describe('errorHandlerExecutor', () => {
  it('routes to "success" when input has no error field', async () => {
    const result = await errorHandlerExecutor.execute(
      { value: 42, name: 'test' },
      {},
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('success');
    expect(result.output).toEqual({ value: 42, name: 'test' });
  });

  it('routes to "error" when input has an error field', async () => {
    const result = await errorHandlerExecutor.execute(
      { error: 'Something went wrong', code: 500 },
      {},
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('error');
    expect(result.output).toEqual({ error: 'Something went wrong', code: 500 });
  });

  it('routes to "error" when error field is null (null !== undefined)', async () => {
    // null is !== undefined, so it counts as a present error field
    const result = await errorHandlerExecutor.execute(
      { error: null },
      {},
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('error');
  });

  it('routes to "error" when error field is an Error object', async () => {
    const result = await errorHandlerExecutor.execute(
      { error: new Error('oops'), data: 'partial' },
      {},
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('error');
  });

  it('passes input through unchanged to output', async () => {
    const input = { x: 1, y: 2, z: [1, 2, 3] };
    const result = await errorHandlerExecutor.execute(input, {}, mockContext);
    expect(result.output).toEqual(input);
  });

  it('routes to "success" on empty input', async () => {
    const result = await errorHandlerExecutor.execute({}, {}, mockContext);
    expect(result.metadata?._selectedHandle).toBe('success');
    expect(result.output).toEqual({});
  });

  it('has correct type', () => {
    expect(errorHandlerExecutor.type).toBe('error-handler');
  });
});

describe('errorHandlerDef', () => {
  it('is control category', () => {
    expect(errorHandlerDef.category).toBe('control');
  });

  it('has success and error outputs', () => {
    expect(errorHandlerDef.outputs.find((o) => o.name === 'success')).toBeDefined();
    expect(errorHandlerDef.outputs.find((o) => o.name === 'error')).toBeDefined();
  });

  it('has a single input', () => {
    expect(errorHandlerDef.inputs).toHaveLength(1);
    expect(errorHandlerDef.inputs[0].name).toBe('input');
  });

  it('has correct type', () => {
    expect(errorHandlerDef.type).toBe('error-handler');
  });
});
