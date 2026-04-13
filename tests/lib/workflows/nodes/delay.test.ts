import { describe, it, expect, vi } from 'vitest';
import { delayExecutor, delayDef } from '$lib/workflows/nodes/delay';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

describe('delayExecutor', () => {
  it('passes input through unchanged', async () => {
    vi.useFakeTimers();
    const promise = delayExecutor.execute({ foo: 'bar' }, { milliseconds: 1000 }, mockContext);
    vi.advanceTimersByTime(1000);
    const result = await promise;
    expect(result.output).toEqual({ foo: 'bar' });
    vi.useRealTimers();
  });

  it('waits the configured delay', async () => {
    vi.useFakeTimers();
    let resolved = false;
    const promise = delayExecutor.execute({}, { milliseconds: 500 }, mockContext).then(() => { resolved = true; });
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(499);
    await Promise.resolve();
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(1);
    await promise;
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });

  it('has correct type', () => {
    expect(delayExecutor.type).toBe('delay');
  });
});

describe('delayDef', () => {
  it('is control category', () => {
    expect(delayDef.category).toBe('control');
  });
});
