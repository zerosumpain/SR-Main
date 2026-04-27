import { describe, it, expect } from 'vitest';
import { manualTriggerExecutor, manualTriggerDef } from '$lib/workflows/nodes/manual-trigger';
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

describe('manualTriggerExecutor', () => {
  it('passes through input as output', async () => {
    const result = await manualTriggerExecutor.execute(
      { message: 'hello' },
      {},
      mockContext,
    );
    expect(result.output).toEqual({ message: 'hello' });
  });

  it('returns empty output when no input', async () => {
    const result = await manualTriggerExecutor.execute({}, {}, mockContext);
    expect(result.output).toEqual({});
  });

  it('has correct type', () => {
    expect(manualTriggerExecutor.type).toBe('manual-trigger');
  });
});

describe('manualTriggerDef', () => {
  it('is a trigger category', () => {
    expect(manualTriggerDef.category).toBe('trigger');
  });

  it('has no inputs and one output', () => {
    expect(manualTriggerDef.inputs).toHaveLength(0);
    expect(manualTriggerDef.outputs).toHaveLength(1);
  });
});
