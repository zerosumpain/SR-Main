import { describe, it, expect } from 'vitest';
import { loopExecutor, loopDef } from '$lib/workflows/nodes/loop';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: '',
  workspaceDir: '/tmp/test',
  dryRun: false,
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

describe('loopExecutor', () => {
  it('iterates over an array with expression', async () => {
    const result = await loopExecutor.execute(
      { items: [1, 2, 3] },
      { arrayPath: 'items', expression: 'return item * 2' },
      mockContext,
    );
    expect(result.output).toEqual({ results: [2, 4, 6], count: 3 });
  });

  it('passes through items when no expression', async () => {
    const result = await loopExecutor.execute(
      { items: ['a', 'b', 'c'] },
      { arrayPath: 'items' },
      mockContext,
    );
    expect(result.output).toEqual({ results: ['a', 'b', 'c'], count: 3 });
  });

  it('returns error for non-array input', async () => {
    const result = await loopExecutor.execute(
      { items: 'not-an-array' },
      { arrayPath: 'items' },
      mockContext,
    );
    expect(result.output).toEqual({ error: 'Not an array', path: 'items' });
  });

  it('returns error when path does not exist', async () => {
    const result = await loopExecutor.execute(
      { foo: 'bar' },
      { arrayPath: 'missing' },
      mockContext,
    );
    expect(result.output).toEqual({ error: 'Not an array', path: 'missing' });
  });

  it('handles nested arrayPath', async () => {
    const result = await loopExecutor.execute(
      { data: { values: [10, 20, 30] } },
      { arrayPath: 'data.values', expression: 'return item + 1' },
      mockContext,
    );
    expect(result.output).toEqual({ results: [11, 21, 31], count: 3 });
  });

  it('exposes index in expression', async () => {
    const result = await loopExecutor.execute(
      { items: ['a', 'b', 'c'] },
      { arrayPath: 'items', expression: 'return index' },
      mockContext,
    );
    expect(result.output).toEqual({ results: [0, 1, 2], count: 3 });
  });

  it('exposes input in expression', async () => {
    const result = await loopExecutor.execute(
      { items: [1, 2], prefix: 'x' },
      { arrayPath: 'items', expression: 'return input.prefix + item' },
      mockContext,
    );
    expect(result.output).toEqual({ results: ['x1', 'x2'], count: 2 });
  });

  it('handles empty array', async () => {
    const result = await loopExecutor.execute(
      { items: [] },
      { arrayPath: 'items', expression: 'return item * 2' },
      mockContext,
    );
    expect(result.output).toEqual({ results: [], count: 0 });
  });

  it('has correct type', () => {
    expect(loopExecutor.type).toBe('loop');
  });
});

describe('loopDef', () => {
  it('is a control category', () => {
    expect(loopDef.category).toBe('control');
  });

  it('has one input and one output', () => {
    expect(loopDef.inputs).toHaveLength(1);
    expect(loopDef.outputs).toHaveLength(1);
  });

  it('output type is array', () => {
    expect(loopDef.outputs[0].type).toBe('array');
  });
});
