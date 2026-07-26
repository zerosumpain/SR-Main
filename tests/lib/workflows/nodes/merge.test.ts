import { describe, it, expect, vi } from 'vitest';
import { mergeExecutor, mergeDef } from '$lib/workflows/nodes/merge';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

const mockContext: ExecutionContext = makeExecutionContext({
  runId: 'test',
  workflowId: 'test',
  getNodeOutput: vi.fn(),
  checkBreakpoint: vi.fn(),
});

describe('mergeExecutor', () => {
  it('passes input through unchanged (deep-merge is the only mode)', async () => {
    const input = { a: 1, b: 'hello', c: [1, 2, 3] };
    const result = await mergeExecutor.execute(input, {}, mockContext);
    expect(result.output).toEqual(input);
  });

  it('ignores legacy strategy/fields config and still merges', async () => {
    const input = { x: 42, y: 'world' };
    const result = await mergeExecutor.execute(input, { strategy: 'deep-merge' }, mockContext);
    expect(result.output).toEqual(input);
  });

  it('returns rowCount=length when input.merged is an array', async () => {
    const input = { merged: [{ a: 1 }, { a: 2 }, { a: 3 }] };
    const result = await mergeExecutor.execute(input, {}, mockContext);
    expect(result.rowCount).toBe(3);
  });

  it('returns rowCount=1 when input has no merged array', async () => {
    const result = await mergeExecutor.execute({ a: 1 }, {}, mockContext);
    expect(result.rowCount).toBe(1);
  });

  it('has correct type', () => {
    expect(mergeExecutor.type).toBe('merge');
  });
});

describe('mergeDef', () => {
  it('is a control category', () => {
    expect(mergeDef.category).toBe('control');
  });

  it('has one input and one output', () => {
    expect(mergeDef.inputs).toHaveLength(1);
    expect(mergeDef.outputs).toHaveLength(1);
  });

  it('has empty defaultConfig (no strategy field)', () => {
    expect(mergeDef.defaultConfig).toEqual({});
  });
});
