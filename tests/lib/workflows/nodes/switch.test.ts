import { describe, it, expect } from 'vitest';
import { switchExecutor, switchDef } from '$lib/workflows/nodes/switch';
import { switchHandles } from '$lib/workflows/nodes/switch.def';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

const mockContext: ExecutionContext = makeExecutionContext({ workflowId: '' });

const cases = [
  { match: '200', handle: 'ok' },
  { match: '404', handle: 'missing' },
];
const baseConfig = { expression: 'input.status', cases, defaultHandle: 'error' };

describe('switchExecutor', () => {
  it('selects the first matching case handle', async () => {
    const result = await switchExecutor.execute({ status: 200 }, baseConfig, mockContext);
    expect(result.metadata?._selectedHandle).toBe('ok');
    expect(result.output.matchedHandle).toBe('ok');
    expect((result.output.matchedCase as any).handle).toBe('ok');
  });

  it('matches a different case', async () => {
    const result = await switchExecutor.execute({ status: 404 }, baseConfig, mockContext);
    expect(result.metadata?._selectedHandle).toBe('missing');
  });

  it('routes to the default handle when nothing matches', async () => {
    const result = await switchExecutor.execute({ status: 500 }, baseConfig, mockContext);
    expect(result.metadata?._selectedHandle).toBe('error');
    expect(result.output.matchedHandle).toBe('error');
    expect(result.output.matchedCase).toBeNull();
  });

  it('uses "default" as the fallback handle when defaultHandle is unset', async () => {
    const result = await switchExecutor.execute(
      { status: 999 },
      { expression: 'input.status', cases },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('default');
  });

  it('picks the FIRST matching case when multiple would match', async () => {
    const dupCases = [
      { match: 'x', handle: 'first' },
      { match: 'x', handle: 'second' },
    ];
    const result = await switchExecutor.execute(
      { v: 'x' },
      { expression: 'input.v', cases: dupCases, defaultHandle: 'd' },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('first');
  });

  it('string-coerces values so a numeric result matches a string case', async () => {
    const result = await switchExecutor.execute(
      { n: 5 },
      { expression: 'input.n + 0', cases: [{ match: '5', handle: 'five' }], defaultHandle: 'd' },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('five');
  });

  it('tolerates a leading return in the expression', async () => {
    const result = await switchExecutor.execute(
      { status: 200 },
      { expression: 'return input.status', cases, defaultHandle: 'error' },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('ok');
  });

  it('routes to default on an expression error', async () => {
    const result = await switchExecutor.execute(
      {},
      { expression: 'nonexistent.deep.value', cases, defaultHandle: 'error' },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('error');
    expect(result.output.error).toBeDefined();
  });

  it('passes the input through to the matched branch', async () => {
    const result = await switchExecutor.execute({ status: 200, payload: 'keep' }, baseConfig, mockContext);
    expect(result.output.payload).toBe('keep');
  });

  it('has correct type', () => {
    expect(switchExecutor.type).toBe('switch');
  });
});

describe('switchHandles', () => {
  it('derives one handle per case plus the default', () => {
    expect(switchHandles(baseConfig)).toEqual(['ok', 'missing', 'error']);
  });

  it('dedupes repeated handles and appends "default" when unset', () => {
    expect(
      switchHandles({
        cases: [
          { match: 'a', handle: 'x' },
          { match: 'b', handle: 'x' },
        ],
      }),
    ).toEqual(['x', 'default']);
  });

  it('does not duplicate the default handle if a case already uses it', () => {
    expect(
      switchHandles({ cases: [{ match: 'a', handle: 'd' }], defaultHandle: 'd' }),
    ).toEqual(['d']);
  });
});

describe('switchDef', () => {
  it('is control category', () => {
    expect(switchDef.category).toBe('control');
  });
  it('declares output handles', () => {
    expect(switchDef.outputs.length).toBeGreaterThanOrEqual(1);
  });
});
