// Tests for the shared ExecutionContext factory.
//
// A test helper that silently drifts from `ExecutionContext` is worse than no
// helper — every consumer would inherit the same wrong default. These assert the
// two properties consumers actually rely on: the returned object is complete,
// and overrides win.
import { describe, it, expect, vi } from 'vitest';
import { makeExecutionContext, makeAbortedExecutionContext } from './execution-context';

// The required members of ExecutionContext. Kept as a literal list rather than
// derived from the type, because the point is to fail when types.ts grows a
// member that the factory does not yet supply — a derived list could not catch
// that. If the gate fails here, add the member to makeExecutionContext and to
// this list.
const REQUIRED_MEMBERS = [
  'runId',
  'workflowId',
  'workspaceDir',
  'dryRun',
  'emit',
  'getNodeOutput',
  'checkBreakpoint',
  'abortSignal',
  'getOutgoingEdges',
  'getIncomingEdges',
  'getNodeConfig',
] as const;

describe('makeExecutionContext', () => {
  it('supplies every required ExecutionContext member', () => {
    const ctx = makeExecutionContext();
    for (const key of REQUIRED_MEMBERS) {
      expect(ctx, `missing member: ${key}`).toHaveProperty(key);
      expect(ctx[key], `member is undefined: ${key}`).toBeDefined();
    }
  });

  it('defaults are inert — no throw, no side effects', async () => {
    const ctx = makeExecutionContext();
    expect(ctx.dryRun).toBe(false);
    expect(ctx.getNodeOutput('anything')).toBeUndefined();
    expect(ctx.getNodeConfig('anything')).toBeUndefined();
    expect(ctx.getOutgoingEdges('anything')).toEqual([]);
    expect(ctx.getIncomingEdges('anything')).toEqual([]);
    await expect(ctx.checkBreakpoint()).resolves.toBeUndefined();
    expect(ctx.abortSignal.aborted).toBe(false);
  });

  it('emit is a spy, so callers can assert without overriding it', () => {
    const ctx = makeExecutionContext();
    ctx.emit({ type: 'log', message: 'hello' } as never);
    expect(ctx.emit).toHaveBeenCalledTimes(1);
  });

  it('overrides replace defaults', () => {
    const emit = vi.fn();
    const ctx = makeExecutionContext({
      runId: 'r-9',
      dryRun: true,
      emit,
      getNodeOutput: () => ({ foo: 'bar' }),
    });
    expect(ctx.runId).toBe('r-9');
    expect(ctx.dryRun).toBe(true);
    expect(ctx.emit).toBe(emit);
    expect(ctx.getNodeOutput('n1')).toEqual({ foo: 'bar' });
    // Un-overridden members keep their defaults.
    expect(ctx.workspaceDir).toBe('/tmp/test');
  });

  it('hands out a fresh abortSignal per call so aborts cannot leak between tests', () => {
    const a = makeExecutionContext();
    const b = makeExecutionContext();
    expect(a.abortSignal).not.toBe(b.abortSignal);
  });
});

describe('makeAbortedExecutionContext', () => {
  it('returns an already-aborted signal carrying the reason', () => {
    const reason = new Error('stop');
    const ctx = makeAbortedExecutionContext({}, reason);
    expect(ctx.abortSignal.aborted).toBe(true);
    expect(ctx.abortSignal.reason).toBe(reason);
  });

  it('still applies overrides', () => {
    const ctx = makeAbortedExecutionContext({ runId: 'r-1' });
    expect(ctx.runId).toBe('r-1');
    expect(ctx.abortSignal.aborted).toBe(true);
  });
});
