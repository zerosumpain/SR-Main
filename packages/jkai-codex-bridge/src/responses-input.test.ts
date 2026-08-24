import { describe, it, expect } from 'vitest';
import {
  splitInstructions,
  messagesToResponsesInput,
  toolsToResponsesTools,
  promptCacheKey,
  clampCallId,
} from './responses-input';
import type { ChatMessage } from './messages';

/**
 * The mapping that replaces `messagesToPrompt` on the Responses transport.
 *
 * Every case here is a shape the site actually sends: a jkai chat turn carries
 * a ~30k-token system prompt, ~55 tools, and by round three a transcript of
 * assistant tool-call requests interleaved with their results. Getting any of
 * those wrong is a 400 from the endpoint, not a degraded answer.
 */
const m = (role: ChatMessage['role'], content: unknown, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ role, content, ...extra }) as ChatMessage;

describe('splitInstructions', () => {
  it('hoists system and developer text into instructions', () => {
    const { instructions, rest } = splitInstructions([
      m('system', 'You are jkai.'),
      m('developer', 'Be terse.'),
      m('user', 'hello'),
    ]);
    expect(instructions).toBe('You are jkai.\n\nBe terse.');
    expect(rest).toHaveLength(1);
    expect(rest[0].role).toBe('user');
  });

  it('leaves instructions empty when there is no system message', () => {
    const { instructions, rest } = splitInstructions([m('user', 'hello')]);
    expect(instructions).toBe('');
    expect(rest).toHaveLength(1);
  });
});

describe('messagesToResponsesInput', () => {
  it('uses input_text for user turns and output_text for assistant turns', () => {
    // Not interchangeable — the endpoint rejects input_text on an assistant turn.
    const items = messagesToResponsesInput([m('user', 'hi'), m('assistant', 'hello')]);
    expect(items[0]).toEqual({ role: 'user', content: [{ type: 'input_text', text: 'hi' }] });
    expect(items[1]).toEqual({ role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] });
  });

  it('turns an assistant tool request into a function_call item', () => {
    const items = messagesToResponsesInput([
      m('assistant', '', {
        tool_calls: [{ id: 'call_abc', function: { name: 'ha_query_state', arguments: '{"x":1}' } }],
      }),
    ]);
    expect(items).toEqual([
      { type: 'function_call', call_id: 'call_abc', name: 'ha_query_state', arguments: '{"x":1}' },
    ]);
  });

  it('keeps assistant prose AND its tool calls, in that order', () => {
    const items = messagesToResponsesInput([
      m('assistant', 'Checking the office light.', {
        tool_calls: [{ id: 'call_1', function: { name: 'ha', arguments: '{}' } }],
      }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ role: 'assistant' });
    expect(items[1]).toMatchObject({ type: 'function_call' });
  });

  it('pairs a tool result to its call via function_call_output', () => {
    const items = messagesToResponsesInput([
      m('tool', 'the light is on', { tool_call_id: 'call_abc', name: 'ha_query_state' }),
    ]);
    expect(items).toEqual([
      { type: 'function_call_output', call_id: 'call_abc', output: 'the light is on' },
    ]);
  });

  it('round-trips a full tool round so every call has a matching output', () => {
    const items = messagesToResponsesInput([
      m('user', 'is the office light on?'),
      m('assistant', '', { tool_calls: [{ id: 'call_x', function: { name: 'ha', arguments: '{}' } }] }),
      m('tool', 'on', { tool_call_id: 'call_x' }),
    ]);
    const callIds = items.filter((i) => i.type === 'function_call').map((i) => i.call_id);
    const outIds = items.filter((i) => i.type === 'function_call_output').map((i) => i.call_id);
    expect(callIds).toEqual(outIds);
  });

  it('drops a tool result with no tool_call_id rather than sending an unroutable item', () => {
    expect(messagesToResponsesInput([m('tool', 'orphan')])).toEqual([]);
  });

  it('drops an empty user turn', () => {
    expect(messagesToResponsesInput([m('user', '   ')])).toEqual([]);
  });

  it('serialises non-string tool arguments', () => {
    const items = messagesToResponsesInput([
      m('assistant', '', { tool_calls: [{ id: 'c', function: { name: 'f', arguments: { a: 1 } as never } }] }),
    ]);
    expect(items[0].arguments).toBe('{"a":1}');
  });

  it('defaults absent arguments to an empty object, never an empty string', () => {
    const items = messagesToResponsesInput([
      m('assistant', '', { tool_calls: [{ id: 'c', function: { name: 'f' } }] }),
    ]);
    expect(items[0].arguments).toBe('{}');
  });
});

describe('toolsToResponsesTools', () => {
  it('flattens the OpenAI nesting the endpoint does not use', () => {
    expect(
      toolsToResponsesTools([
        { type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } } },
      ]),
    ).toEqual([{ type: 'function', name: 'f', description: 'd', parameters: { type: 'object' } }]);
  });

  it('drops a nameless tool — it could be listed but never called', () => {
    expect(toolsToResponsesTools([{ type: 'function', function: { description: 'x' } }])).toEqual([]);
  });

  it('gives a schema-less tool an empty object schema rather than undefined', () => {
    expect(toolsToResponsesTools([{ type: 'function', function: { name: 'f' } }])[0].parameters).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('is safe on a non-array', () => {
    expect(toolsToResponsesTools(undefined)).toEqual([]);
  });
});

describe('promptCacheKey', () => {
  it('is stable for the same instructions — that is the whole point', () => {
    expect(promptCacheKey('You are jkai.')).toBe(promptCacheKey('You are jkai.'));
  });

  it('differs for different instructions, so two system prompts cannot share a cache', () => {
    expect(promptCacheKey('You are jkai.')).not.toBe(promptCacheKey('You are someone else.'));
  });

  it('is bounded regardless of how large the system prompt gets', () => {
    expect(promptCacheKey('x'.repeat(200_000))!.length).toBeLessThanOrEqual(32);
  });

  it('is undefined with no instructions, so the field is omitted rather than sent empty', () => {
    expect(promptCacheKey('')).toBeUndefined();
  });
});

describe('clampCallId', () => {
  it('leaves a normal id alone', () => {
    expect(clampCallId('call_abc123')).toBe('call_abc123');
  });

  it('clamps an over-long id — the endpoint rejects the whole request otherwise', () => {
    expect(clampCallId('c'.repeat(200))).toHaveLength(64);
  });
});
