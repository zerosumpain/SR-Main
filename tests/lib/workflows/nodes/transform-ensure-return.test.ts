import { describe, it, expect } from 'vitest';
import { transformExecutor } from '$lib/workflows/nodes/transform';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

/**
 * Exercises transform's `ensureReturn` helper (not exported — tested through
 * the executor). The helper exists because LLM-authored transform bodies
 * frequently omit the explicit `return` and leave a trailing value
 * expression; without the fix the body evaluates to undefined and downstream
 * nodes silently receive empty input (this broke whatsapp sends from canvas
 * builds, per the source comment).
 */

const mockContext: ExecutionContext = makeExecutionContext({ workflowId: '' });

describe('transform ensureReturn — implicit return handling', () => {
  it('wraps a bare object-literal expression with no return', async () => {
    const result = await transformExecutor.execute(
      { name: 'x' },
      { expression: '({ greeting: "hi " + input.name })' },
      mockContext,
    );
    expect(result.output).toEqual({ greeting: 'hi x' });
  });

  it('wraps a bare spread-object expression with no return', async () => {
    const result = await transformExecutor.execute(
      { a: 1 },
      { expression: '{ ...input, b: 2 }' },
      mockContext,
    );
    expect(result.output).toEqual({ a: 1, b: 2 });
  });

  it('handles `const x = ...; <expression>` trailing-expression style', async () => {
    const result = await transformExecutor.execute(
      { value: 7 },
      { expression: 'const doubled = input.value * 2; ({ doubled })' },
      mockContext,
    );
    expect(result.output).toEqual({ doubled: 14 });
  });

  it('leaves an explicit return untouched', async () => {
    const result = await transformExecutor.execute(
      { value: 3 },
      { expression: 'return { tripled: input.value * 3 }' },
      mockContext,
    );
    expect(result.output).toEqual({ tripled: 9 });
  });

  it('wraps a bare scalar expression and reports it under result', async () => {
    const result = await transformExecutor.execute(
      { value: 4 },
      { expression: 'input.value + 1' },
      mockContext,
    );
    // Non-object results are wrapped as { result }.
    expect(result.output).toEqual({ result: 5 });
  });
});
