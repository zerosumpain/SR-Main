import { describe, it, expect } from 'vitest';
import { accumulatorExecutor, accumulatorDef } from '$lib/workflows/nodes/accumulator';
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
  getOutgoingEdges: () => [],
  getIncomingEdges: () => [],
  getNodeConfig: () => undefined,
};

describe('accumulatorExecutor', () => {
  it('collects a named array field from input', async () => {
    const result = await accumulatorExecutor.execute(
      { results: ['a', 'b', 'c'], other: 'data' },
      { collectField: 'results' },
      mockContext,
    );
    expect(result.output).toEqual({ items: ['a', 'b', 'c'], count: 3 });
  });

  it('wraps non-array field as single-item array', async () => {
    const result = await accumulatorExecutor.execute(
      { score: 42, name: 'test' },
      { collectField: 'score' },
      mockContext,
    );
    expect(result.output).toEqual({ items: [42], count: 1 });
  });

  it('wraps entire input when no collectField specified', async () => {
    const input = { foo: 'bar', baz: 123 };
    const result = await accumulatorExecutor.execute(input, {}, mockContext);
    expect(result.output).toEqual({ items: [input], count: 1 });
  });

  it('wraps entire input when collectField is empty string', async () => {
    const input = { x: 1 };
    const result = await accumulatorExecutor.execute(input, { collectField: '' }, mockContext);
    expect(result.output).toEqual({ items: [input], count: 1 });
  });

  it('returns count matching items length', async () => {
    const result = await accumulatorExecutor.execute(
      { values: [10, 20, 30, 40] },
      { collectField: 'values' },
      mockContext,
    );
    const output = result.output as { items: unknown[]; count: number };
    expect(output.count).toBe(output.items.length);
    expect(output.count).toBe(4);
  });

  it('falls back to wrapping entire input when collectField does not exist', async () => {
    const input = { foo: 'bar' };
    const result = await accumulatorExecutor.execute(
      input,
      { collectField: 'missing' },
      mockContext,
    );
    expect(result.output).toEqual({ items: [input], count: 1 });
  });

  it('handles empty array field', async () => {
    const result = await accumulatorExecutor.execute(
      { items: [] },
      { collectField: 'items' },
      mockContext,
    );
    expect(result.output).toEqual({ items: [], count: 0 });
  });

  it('has correct type', () => {
    expect(accumulatorExecutor.type).toBe('accumulator');
  });
});

describe('accumulatorDef', () => {
  it('is a control category', () => {
    expect(accumulatorDef.category).toBe('control');
  });

  it('has one input and one output', () => {
    expect(accumulatorDef.inputs).toHaveLength(1);
    expect(accumulatorDef.outputs).toHaveLength(1);
  });

  it('output type is object', () => {
    expect(accumulatorDef.outputs[0].type).toBe('object');
  });

  it('default config has empty collectField', () => {
    expect(accumulatorDef.defaultConfig).toEqual({ collectField: '' });
  });
});
