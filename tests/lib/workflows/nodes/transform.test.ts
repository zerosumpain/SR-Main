import { describe, it, expect } from 'vitest';
import { transformExecutor, transformDef } from '$lib/workflows/nodes/transform';
import { UnsafeExpressionError } from '$lib/workflows/nodes/safe-eval';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: '',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

describe('transformExecutor', () => {
  it('evaluates a simple expression', async () => {
    const result = await transformExecutor.execute(
      { value: 5 },
      { expression: 'return { doubled: input.value * 2 }' },
      mockContext,
    );
    expect(result.output).toEqual({ doubled: 10 });
  });

  it('has access to full input object', async () => {
    const result = await transformExecutor.execute(
      { items: [1, 2, 3] },
      { expression: 'return { count: input.items.length }' },
      mockContext,
    );
    expect(result.output).toEqual({ count: 3 });
  });

  it('passes through input when no expression', async () => {
    const result = await transformExecutor.execute(
      { a: 1 },
      {},
      mockContext,
    );
    expect(result.output).toEqual({ a: 1 });
  });

  it('throws on bad expression', async () => {
    await expect(
      transformExecutor.execute(
        {},
        { expression: 'throw new Error("boom")' },
        mockContext,
      ),
    ).rejects.toThrow('Transform expression failed: boom');
  });

  it('re-throws UnsafeExpressionError unwrapped', async () => {
    await expect(
      transformExecutor.execute(
        {},
        { expression: 'return require("fs")' },
        mockContext,
      ),
    ).rejects.toThrow(UnsafeExpressionError);
  });

  it('has correct type', () => {
    expect(transformExecutor.type).toBe('transform');
  });
});

describe('transformDef', () => {
  it('is a core category', () => {
    expect(transformDef.category).toBe('core');
  });

  it('has one input and one output', () => {
    expect(transformDef.inputs).toHaveLength(1);
    expect(transformDef.outputs).toHaveLength(1);
  });
});
