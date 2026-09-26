import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import { runToolLoop, parseToolArgs, type ToolLoopCall } from './tool-loop';
import { currentActivityId } from '$lib/context/activity';

type Msg = { content?: string | null; tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments: string } }> };

/** A client whose `create` answers from a script, one entry per call. `null`
 *  scripts a response with no choices. */
function fakeClient(script: Array<Msg | null>, usage = { prompt_tokens: 10, completion_tokens: 2 }) {
  const seen: Array<Record<string, unknown>> = [];
  const create = vi.fn(async (params: Record<string, unknown>, _opts?: { signal?: AbortSignal }) => {
    // Snapshot: the loop mutates `messages` after the call returns.
    seen.push({ ...params, messages: [...(params.messages as unknown[])] });
    const next = script.shift();
    if (next === undefined) throw new Error('script exhausted');
    return { choices: next === null ? [] : [{ message: next }], usage };
  });
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return { client, create, seen };
}

const call = (id: string, name: string, args: string) => ({ id, type: 'function', function: { name, arguments: args } });
const tools = [{ type: 'function', function: { name: 'look', parameters: { type: 'object' } } }];
const base = () => [{ role: 'system', content: 'sys' }, { role: 'user', content: 'go' }] as Array<Record<string, unknown>>;

describe('runToolLoop', () => {
  it('returns a plain reply and sends no tools when none are given', async () => {
    const { client, seen } = fakeClient([{ content: '  hello  ' }]);
    const r = await runToolLoop({ client, model: 'm', messages: base(), execute: vi.fn(), maxRounds: 3 });
    expect(r).toMatchObject({ reply: 'hello', rounds: 1, stop: 'reply', calls: [] });
    expect(seen[0]).not.toHaveProperty('tools');
  });

  it('appends the assistant turn and tool results in order', async () => {
    const { client, seen } = fakeClient([
      { content: 'thinking', tool_calls: [call('a', 'look', '{"q":1}'), call('b', 'look', '{"q":2}')] },
      { content: 'done' },
    ]);
    const messages = base();
    const execute = vi.fn(async (c: ToolLoopCall, round: number) => `${c.id}:${JSON.stringify(c.args)}:${round}`);
    const r = await runToolLoop({ client, model: 'm', messages, tools, execute, maxRounds: 3, temperature: 0.6, maxTokens: 100 });
    expect(r.stop).toBe('reply');
    expect(r.reply).toBe('done');
    expect(r.rounds).toBe(2);
    expect(r.calls.map((c) => c.id)).toEqual(['a', 'b']);
    expect(messages.slice(2)).toEqual([
      { role: 'assistant', content: 'thinking', tool_calls: [call('a', 'look', '{"q":1}'), call('b', 'look', '{"q":2}')] },
      { role: 'tool', tool_call_id: 'a', content: 'a:{"q":1}:0' },
      { role: 'tool', tool_call_id: 'b', content: 'b:{"q":2}:0' },
    ]);
    expect(seen[0]).toMatchObject({ model: 'm', temperature: 0.6, max_tokens: 100, tools });
  });

  it('turns malformed or non-object arguments into {}', async () => {
    const { client } = fakeClient([
      { tool_calls: [call('a', 'look', '{not json'), call('b', 'look', '[1,2]'), call('c', 'look', '')] },
      { content: 'ok' },
    ]);
    const execute = vi.fn(async (_c: ToolLoopCall) => 'r');
    await runToolLoop({ client, model: 'm', messages: base(), tools, execute, maxRounds: 2 });
    expect(execute.mock.calls.map(([c]) => c.args)).toEqual([{}, {}, {}]);
    expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
  });

  it('forces a final call without tools, with the prompt appended, when rounds run out', async () => {
    const { client, seen } = fakeClient([
      { content: '', tool_calls: [call('a', 'look', '{}')] },
      { content: '', tool_calls: [call('b', 'look', '{}')] },
      { content: ' {"notes":[]} ' },
    ]);
    const r = await runToolLoop({
      client, model: 'm', messages: base(), tools, execute: async () => 'r', maxRounds: 2,
      temperature: 0.6, forceFinal: { prompt: 'No more tools.', temperature: 0.4 },
    });
    expect(r).toMatchObject({ reply: '{"notes":[]}', rounds: 3, stop: 'final' });
    const last = seen[2];
    expect(last).not.toHaveProperty('tools');
    expect(last.temperature).toBe(0.4);
    expect((last.messages as Array<Record<string, unknown>>).at(-1)).toEqual({ role: 'user', content: 'No more tools.' });
  });

  it('goes straight to the forced final when a response carries no message', async () => {
    const { client, seen } = fakeClient([null, { content: 'fin' }]);
    const r = await runToolLoop({ client, model: 'm', messages: base(), tools, execute: async () => 'r', maxRounds: 5, forceFinal: { prompt: 'Now.' } });
    expect(r).toMatchObject({ reply: 'fin', rounds: 2, stop: 'final' });
    expect(seen[1]).not.toHaveProperty('tools');
  });

  it('ends empty with max_rounds when forceFinal is false', async () => {
    const { client, create } = fakeClient([{ tool_calls: [call('a', 'look', '{}')] }]);
    const r = await runToolLoop({ client, model: 'm', messages: base(), tools, execute: async () => 'r', maxRounds: 1, forceFinal: false });
    expect(r).toMatchObject({ reply: '', rounds: 1, stop: 'max_rounds' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('reports empty when a response has no message and there is no forced final', async () => {
    const { client } = fakeClient([null]);
    const r = await runToolLoop({ client, model: 'm', messages: base(), tools, execute: async () => 'r', maxRounds: 3 });
    expect(r).toMatchObject({ reply: '', rounds: 1, stop: 'empty' });
  });

  it('sums usage across every round, the forced final included', async () => {
    const { client } = fakeClient(
      [{ tool_calls: [call('a', 'look', '{}')] }, { tool_calls: [call('b', 'look', '{}')] }, { content: 'x' }],
      { prompt_tokens: 7, completion_tokens: 3 },
    );
    const r = await runToolLoop({ client, model: 'm', messages: base(), tools, execute: async () => 'r', maxRounds: 2, forceFinal: { prompt: 'p' } });
    expect(r.usage).toEqual({ prompt: 21, completion: 9 });
  });

  it('stops without further calls once the signal aborts', async () => {
    const ctl = new AbortController();
    const { client, create } = fakeClient([
      { tool_calls: [call('a', 'look', '{}'), call('b', 'look', '{}')] },
      { content: 'never' },
    ]);
    const execute = vi.fn(async () => {
      ctl.abort();
      return 'r';
    });
    const r = await runToolLoop({
      client, model: 'm', messages: base(), tools, execute, maxRounds: 3, signal: ctl.signal, forceFinal: { prompt: 'p' },
    });
    expect(r).toMatchObject({ reply: '', stop: 'aborted' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it('makes no call at all on an already-aborted signal', async () => {
    const { client, create } = fakeClient([{ content: 'x' }]);
    const r = await runToolLoop({ client, model: 'm', messages: base(), execute: async () => 'r', maxRounds: 3, signal: AbortSignal.abort() });
    expect(r.stop).toBe('aborted');
    expect(create).not.toHaveBeenCalled();
  });

  it('runs every create inside the activity when one is given, and none otherwise', async () => {
    const tags: Array<string | null> = [];
    const mk = () => {
      const { client, create } = fakeClient([{ tool_calls: [call('a', 'look', '{}')] }, { content: 'x' }]);
      const inner = create.getMockImplementation()!;
      create.mockImplementation(async (p) => {
        tags.push(currentActivityId());
        return inner(p);
      });
      return client;
    };
    await runToolLoop({ client: mk(), model: 'm', messages: base(), tools, execute: async () => 'r', maxRounds: 2, activity: 'daydream' });
    await runToolLoop({ client: mk(), model: 'm', messages: base(), tools, execute: async () => 'r', maxRounds: 2 });
    expect(tags).toEqual(['daydream', 'daydream', null, null]);
  });

  it('calls onRound with each round and its calls', async () => {
    const { client } = fakeClient([{ content: 'a', tool_calls: [call('a', 'look', '{"x":1}')] }, { content: 'b' }]);
    const onRound = vi.fn();
    await runToolLoop({ client, model: 'm', messages: base(), tools, execute: async () => 'r', maxRounds: 2, onRound });
    expect(onRound.mock.calls.map(([r]) => [r.round, r.content, r.calls.length])).toEqual([[0, 'a', 1], [1, 'b', 0]]);
  });
});
