import { describe, it, expect, vi } from 'vitest';
import { mergeExecutor, mergeDef } from '$lib/workflows/nodes/merge';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test',
  workflowId: 'test',
  workspaceDir: '/tmp/test',
  emit: vi.fn(),
  getNodeOutput: vi.fn(),
  checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
};

describe('mergeExecutor', () => {
  it('deep-merge passes input through unchanged', async () => {
    const input = { a: 1, b: 'hello', c: [1, 2, 3] };
    const result = await mergeExecutor.execute(input, { strategy: 'deep-merge' }, mockContext);
    expect(result.output).toEqual(input);
  });

  it('deep-merge is default when no strategy provided', async () => {
    const input = { x: 42, y: 'world' };
    const result = await mergeExecutor.execute(input, {}, mockContext);
    expect(result.output).toEqual(input);
  });

  it('pick extracts only specified fields', async () => {
    const input = { name: 'Alice', age: 30, role: 'admin', secret: 'hidden' };
    const result = await mergeExecutor.execute(input, { strategy: 'pick', fields: 'name, age' }, mockContext);
    expect(result.output).toEqual({ name: 'Alice', age: 30 });
  });

  it('pick with nonexistent fields returns empty object', async () => {
    const input = { a: 1, b: 2 };
    const result = await mergeExecutor.execute(input, { strategy: 'pick', fields: 'x, y, z' }, mockContext);
    expect(result.output).toEqual({});
  });

  it('pick with empty fields string returns empty object', async () => {
    const input = { a: 1, b: 2 };
    const result = await mergeExecutor.execute(input, { strategy: 'pick', fields: '' }, mockContext);
    expect(result.output).toEqual({});
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

  it('has deep-merge as default strategy', () => {
    expect(mergeDef.defaultConfig?.strategy).toBe('deep-merge');
  });
});
