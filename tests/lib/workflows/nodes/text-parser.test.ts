import { describe, it, expect } from 'vitest';
import { textParserExecutor, textParserDef } from '$lib/workflows/nodes/text-parser';
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

describe('textParserExecutor — JSON mode', () => {
  it('extracts JSON from a markdown code block', async () => {
    const input = { response: '```json\n{"score": 42, "label": "good"}\n```' };
    const result = await textParserExecutor.execute(input, { mode: 'json' }, mockContext);
    expect(result.output.parsed).toEqual({ score: 42, label: 'good' });
  });

  it('extracts raw JSON string directly', async () => {
    const input = { response: '{"name": "Alice", "age": 30}' };
    const result = await textParserExecutor.execute(input, { mode: 'json' }, mockContext);
    expect(result.output.parsed).toEqual({ name: 'Alice', age: 30 });
  });

  it('extracts embedded {...} from surrounding text', async () => {
    const input = { response: 'Here is the result: {"value": 99} — end of response.' };
    const result = await textParserExecutor.execute(input, { mode: 'json' }, mockContext);
    expect(result.output.parsed).toEqual({ value: 99 });
  });

  it('returns { parsed: null, error } when no JSON found', async () => {
    const input = { response: 'No JSON here at all, just plain text.' };
    const result = await textParserExecutor.execute(input, { mode: 'json' }, mockContext);
    expect(result.output.parsed).toBeNull();
    expect(result.output.error).toBeTruthy();
  });

  it('spreads original input fields into output', async () => {
    const input = { response: '{"x": 1}', upstream: 'data' };
    const result = await textParserExecutor.execute(input, { mode: 'json' }, mockContext);
    expect(result.output.upstream).toBe('data');
    expect((result.output.parsed as { x: number }).x).toBe(1);
  });

  it('reads from a custom inputField', async () => {
    const input = { text: '{"ok": true}' };
    const result = await textParserExecutor.execute(input, { mode: 'json', inputField: 'text' }, mockContext);
    expect(result.output.parsed).toEqual({ ok: true });
  });
});

describe('textParserExecutor — Regex mode', () => {
  it('captures groups correctly', async () => {
    const input = { response: 'Order #12345 placed.' };
    const result = await textParserExecutor.execute(
      input,
      { mode: 'regex', pattern: '#(\\d+)' },
      mockContext,
    );
    expect(result.output.match).toBe('#12345');
    // groups is an array of capture groups when no named groups
    expect(Array.isArray(result.output.groups) || result.output.groups === null || typeof result.output.groups === 'object').toBe(true);
    // first capture group
    const groups = result.output.groups as string[];
    expect(groups[0]).toBe('12345');
  });

  it('returns allMatches for global flag', async () => {
    const input = { response: 'a1 b2 c3' };
    const result = await textParserExecutor.execute(
      input,
      { mode: 'regex', pattern: '\\d', flags: 'g' },
      mockContext,
    );
    expect(result.output.allMatches).toEqual(['1', '2', '3']);
  });

  it('returns null match when pattern does not match', async () => {
    const input = { response: 'no numbers here' };
    const result = await textParserExecutor.execute(
      input,
      { mode: 'regex', pattern: '\\d+' },
      mockContext,
    );
    expect(result.output.match).toBeNull();
    expect(result.output.allMatches).toEqual([]);
  });

  it('returns error when no pattern is provided', async () => {
    const input = { response: 'some text' };
    const result = await textParserExecutor.execute(input, { mode: 'regex' }, mockContext);
    expect(result.output.error).toBeTruthy();
  });
});

describe('textParserExecutor — Split mode', () => {
  it('splits by newline and returns items and count', async () => {
    const input = { response: 'line one\nline two\nline three' };
    const result = await textParserExecutor.execute(input, { mode: 'split' }, mockContext);
    expect(result.output.items).toEqual(['line one', 'line two', 'line three']);
    expect(result.output.count).toBe(3);
  });

  it('splits by a custom delimiter', async () => {
    const input = { response: 'a,b,c,d' };
    const result = await textParserExecutor.execute(
      input,
      { mode: 'split', delimiter: ',' },
      mockContext,
    );
    expect(result.output.items).toEqual(['a', 'b', 'c', 'd']);
    expect(result.output.count).toBe(4);
  });

  it('filters out empty strings from split', async () => {
    const input = { response: 'one\n\ntwo\n\nthree' };
    const result = await textParserExecutor.execute(input, { mode: 'split' }, mockContext);
    expect(result.output.items).toEqual(['one', 'two', 'three']);
    expect(result.output.count).toBe(3);
  });
});

describe('textParserDef', () => {
  it('has correct type and category', () => {
    expect(textParserDef.type).toBe('text-parser');
    expect(textParserDef.category).toBe('core');
  });

  it('has one input and one output', () => {
    expect(textParserDef.inputs).toHaveLength(1);
    expect(textParserDef.outputs).toHaveLength(1);
  });

  it('has basicConfig with mode dropdown', () => {
    const modeField = textParserDef.basicConfig?.find((f) => f.key === 'mode');
    expect(modeField).toBeDefined();
    expect(modeField?.type).toBe('dropdown');
  });
});
