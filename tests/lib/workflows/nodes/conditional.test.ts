import { describe, it, expect } from 'vitest';
import { conditionalExecutor, conditionalDef } from '$lib/workflows/nodes/conditional';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
} as any;

describe('conditionalExecutor', () => {
  it('sets _selectedHandle to "true" when expression is truthy', async () => {
    const result = await conditionalExecutor.execute(
      { count: 15 },
      { expression: 'input.count > 10' },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('true');
    expect(result.output).toEqual({ count: 15 });
  });

  it('sets _selectedHandle to "false" when expression is falsy', async () => {
    const result = await conditionalExecutor.execute(
      { count: 5 },
      { expression: 'input.count > 10' },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('false');
  });

  it('handles expression errors gracefully — routes to false', async () => {
    const result = await conditionalExecutor.execute(
      {},
      { expression: 'nonexistent.property.deep' },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('false');
    expect(result.output.error).toBeDefined();
  });

  it('has correct type', () => {
    expect(conditionalExecutor.type).toBe('conditional');
  });
});

describe('conditionalDef', () => {
  it('is control category', () => {
    expect(conditionalDef.category).toBe('control');
  });
  it('has true and false outputs', () => {
    expect(conditionalDef.outputs.find(o => o.name === 'true')).toBeDefined();
    expect(conditionalDef.outputs.find(o => o.name === 'false')).toBeDefined();
  });
});
