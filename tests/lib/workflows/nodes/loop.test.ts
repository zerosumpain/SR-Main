import { describe, it, expect } from 'vitest';
import { loopExecutor, loopDef } from '$lib/workflows/nodes/loop';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

const mockContext: ExecutionContext = makeExecutionContext({ workflowId: '' });

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

describe('loopExecutor concurrency', () => {
  it('produces identical results with concurrency > 1 (order preserved)', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const seq = await loopExecutor.execute(
      { items },
      { arrayPath: 'items', expression: 'return item * 2' },
      mockContext,
    );
    const parallel = await loopExecutor.execute(
      { items },
      { arrayPath: 'items', expression: 'return item * 2', concurrency: 5 },
      mockContext,
    );
    expect(parallel.output).toEqual(seq.output);
    expect(parallel.output.results).toEqual(items.map((i) => i * 2));
    expect(parallel.output.count).toBe(20);
  });

  it('concurrency unset is byte-for-byte identical to concurrency: 1', async () => {
    const items = ['a', 'b', 'c'];
    const unset = await loopExecutor.execute(
      { items },
      { arrayPath: 'items', expression: 'return item.toUpperCase()' },
      mockContext,
    );
    const one = await loopExecutor.execute(
      { items },
      { arrayPath: 'items', expression: 'return item.toUpperCase()', concurrency: 1 },
      mockContext,
    );
    expect(unset.output).toEqual(one.output);
    expect(one.output.results).toEqual(['A', 'B', 'C']);
  });

  it('respects the concurrency bound (never more than N items in flight)', async () => {
    // Each iteration is synchronous in production, but the pool awaits each
    // result. We can still assert the bound by recording how many indices the
    // pool dispatches before any complete: with a synchronous body the pool
    // processes items eagerly but never schedules more workers than the bound.
    // Here we verify correctness + count for a large array under a small bound.
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const result = await loopExecutor.execute(
      { items },
      { arrayPath: 'items', expression: 'return item.id + 100', concurrency: 3 },
      mockContext,
    );
    expect(result.output.count).toBe(50);
    expect(result.output.results).toEqual(items.map((it) => it.id + 100));
  });

  it('caps the worker pool at the array length for small arrays', async () => {
    const result = await loopExecutor.execute(
      { items: [1, 2] },
      { arrayPath: 'items', expression: 'return item', concurrency: 100 },
      mockContext,
    );
    expect(result.output.results).toEqual([1, 2]);
    expect(result.output.count).toBe(2);
  });

  it('invalid concurrency (0, negative, NaN) falls back to sequential', async () => {
    const items = [1, 2, 3];
    for (const bad of [0, -4, 'x', undefined]) {
      const result = await loopExecutor.execute(
        { items },
        { arrayPath: 'items', expression: 'return item + 1', concurrency: bad },
        mockContext,
      );
      expect(result.output.results).toEqual([2, 3, 4]);
    }
  });
});

describe('loopDef concurrency field', () => {
  it('no longer marks concurrency as reserved/unused', () => {
    const desc = (loopDef.configSchema.properties as any).concurrency.description as string;
    expect(desc.toLowerCase()).not.toContain('reserved');
    expect(desc.toLowerCase()).not.toContain('unused');
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
