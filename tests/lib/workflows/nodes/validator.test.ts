import { describe, it, expect, vi } from 'vitest';
import { validatorExecutor, validatorDef } from '$lib/workflows/nodes/validator';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test',
  workflowId: 'test',
  workspaceDir: '/tmp/test',
  emit: vi.fn(),
  getNodeOutput: vi.fn(),
  checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
} as any;

describe('validatorExecutor — schema mode', () => {
  const schema = JSON.stringify({ type: 'object', required: ['name', 'score'], properties: { name: { type: 'string' }, score: { type: 'number' } } });

  it('passes when all required fields are present', async () => {
    const result = await validatorExecutor.execute(
      { name: 'Alice', score: 95 },
      { mode: 'schema', schema },
      mockContext,
    );
    expect(result.output.valid).toBe(true);
    expect(result.output.errors).toEqual([]);
    expect(result.metadata?._selectedHandle).toBe('pass');
  });

  it('fails when a required field is missing', async () => {
    const result = await validatorExecutor.execute(
      { name: 'Alice' },
      { mode: 'schema', schema },
      mockContext,
    );
    expect(result.output.valid).toBe(false);
    expect(Array.isArray(result.output.errors)).toBe(true);
    expect((result.output.errors as string[]).some(e => e.includes('score'))).toBe(true);
    expect(result.metadata?._selectedHandle).toBe('fail');
  });

  it('fails when a field has the wrong type', async () => {
    const result = await validatorExecutor.execute(
      { name: 'Alice', score: 'not-a-number' },
      { mode: 'schema', schema },
      mockContext,
    );
    expect(result.output.valid).toBe(false);
    expect(result.metadata?._selectedHandle).toBe('fail');
  });

  it('returns fail with error when schema is invalid JSON', async () => {
    const result = await validatorExecutor.execute(
      { name: 'Alice' },
      { mode: 'schema', schema: '{ bad json' },
      mockContext,
    );
    expect(result.output.valid).toBe(false);
    expect(result.metadata?._selectedHandle).toBe('fail');
    expect((result.output.errors as string[]).some(e => e.toLowerCase().includes('invalid'))).toBe(true);
  });
});

describe('validatorExecutor — expression mode', () => {
  it('passes when expression evaluates to true (score >= 80 with score: 85)', async () => {
    const result = await validatorExecutor.execute(
      { score: 85 },
      { mode: 'expression', expression: 'input.score >= 80' },
      mockContext,
    );
    expect(result.output.valid).toBe(true);
    expect(result.metadata?._selectedHandle).toBe('pass');
  });

  it('fails when expression evaluates to false (score >= 80 with score: 50)', async () => {
    const result = await validatorExecutor.execute(
      { score: 50 },
      { mode: 'expression', expression: 'input.score >= 80' },
      mockContext,
    );
    expect(result.output.valid).toBe(false);
    expect(result.metadata?._selectedHandle).toBe('fail');
  });

  it('fails when expression is empty', async () => {
    const result = await validatorExecutor.execute(
      { score: 99 },
      { mode: 'expression', expression: '' },
      mockContext,
    );
    expect(result.output.valid).toBe(false);
    expect(result.metadata?._selectedHandle).toBe('fail');
    expect((result.output.errors as string[]).some(e => e.toLowerCase().includes('empty'))).toBe(true);
  });

  it('fails gracefully when expression throws', async () => {
    const result = await validatorExecutor.execute(
      {},
      { mode: 'expression', expression: 'nonexistent.deeply.nested.prop' },
      mockContext,
    );
    expect(result.output.valid).toBe(false);
    expect(result.metadata?._selectedHandle).toBe('fail');
    expect(Array.isArray(result.output.errors)).toBe(true);
  });
});

describe('validatorExecutor — unknown mode', () => {
  it('routes to fail for unknown mode', async () => {
    const result = await validatorExecutor.execute(
      { foo: 'bar' },
      { mode: 'unknown' },
      mockContext,
    );
    expect(result.output.valid).toBe(false);
    expect(result.metadata?._selectedHandle).toBe('fail');
  });
});

describe('validatorDef', () => {
  it('is agentic category', () => {
    expect(validatorDef.category).toBe('agentic');
  });

  it('has pass and fail outputs', () => {
    expect(validatorDef.outputs.find(o => o.name === 'pass')).toBeDefined();
    expect(validatorDef.outputs.find(o => o.name === 'fail')).toBeDefined();
  });

  it('has correct type', () => {
    expect(validatorDef.type).toBe('validator');
    expect(validatorExecutor.type).toBe('validator');
  });

  it('has mode in required config schema', () => {
    expect(validatorDef.configSchema.required).toContain('mode');
  });
});
