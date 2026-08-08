import { describe, it, expect } from 'vitest';
import {
  messagesToPrompt,
  flattenContent,
  extractOutputSchema,
  wantsBareJson,
} from './messages';

describe('messagesToPrompt', () => {
  it('passes a lone user message through verbatim', () => {
    // The commonest shape on the site. Adding "User:" scaffolding here made
    // replies drift transcript-shaped, so a bare prompt must stay bare.
    expect(messagesToPrompt([{ role: 'user', content: 'Summarise this in one line.' }])).toBe(
      'Summarise this in one line.',
    );
  });

  it('hoists the system message above the user turn', () => {
    const out = messagesToPrompt([
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'Hello' },
    ]);
    expect(out).toBe('You are terse.\n\n---\n\nHello');
  });

  it('hoists system messages that arrive late in the array', () => {
    // Codex has no system channel; leaving a trailing system message inline
    // made the model treat a standing rule as a conversational aside.
    const out = messagesToPrompt([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'system', content: 'Always answer in French.' },
      { role: 'user', content: 'How are you?' },
    ]);
    expect(out.startsWith('Always answer in French.')).toBe(true);
    expect(out).toContain('User:\nHi');
    expect(out).toContain('Assistant:\nHello');
  });

  it('labels multi-turn conversations', () => {
    const out = messagesToPrompt([
      { role: 'user', content: 'One' },
      { role: 'assistant', content: 'Two' },
      { role: 'user', content: 'Three' },
    ]);
    expect(out).toBe('User:\nOne\n\nAssistant:\nTwo\n\nUser:\nThree');
  });

  it('drops empty messages rather than emitting blank turns', () => {
    expect(messagesToPrompt([
      { role: 'system', content: '   ' },
      { role: 'user', content: 'Only this' },
    ])).toBe('Only this');
  });
});

describe('flattenContent', () => {
  it('joins text parts', () => {
    expect(flattenContent([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
  });

  it('names an omitted image instead of dropping it silently', () => {
    // A caller that attached an image should be able to see in the prompt why
    // the answer ignored it.
    expect(flattenContent([{ type: 'image_url', image_url: { url: 'x' } }])).toContain(
      'image omitted',
    );
  });

  it('passes strings through', () => {
    expect(flattenContent('plain')).toBe('plain');
  });
});

describe('response_format mapping', () => {
  it('extracts a json_schema schema for Codex outputSchema', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    expect(extractOutputSchema({ type: 'json_schema', json_schema: { schema } })).toEqual(schema);
  });

  it('returns undefined for bare json_object and flags it instead', () => {
    expect(extractOutputSchema({ type: 'json_object' })).toBeUndefined();
    expect(wantsBareJson({ type: 'json_object' })).toBe(true);
  });

  it('ignores an absent response_format', () => {
    expect(extractOutputSchema(undefined)).toBeUndefined();
    expect(wantsBareJson(undefined)).toBe(false);
  });
});

describe('tool-calling transcripts', () => {
  it('renders an assistant turn that only requested tools', () => {
    // The bridge aborts the turn that produced the call and starts a fresh
    // thread next time, so the transcript is the ONLY place the model can
    // learn what it previously asked for. Drop it and the model re-requests
    // the same call, looping the caller.
    const out = messagesToPrompt([
      { role: 'user', content: 'Weather in Oslo?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', function: { name: 'get_weather', arguments: '{"city":"Oslo"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', name: 'get_weather', content: '{"tempC":-3}' },
    ]);
    expect(out).toContain('get_weather({"city":"Oslo"})');
    expect(out).toContain('Tool result (get_weather):');
    expect(out).toContain('{"tempC":-3}');
  });

  it('keeps a tool-request turn even though it has no content', () => {
    const out = messagesToPrompt([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'ping', arguments: '{}' } }] },
    ]);
    expect(out).toContain('ping({})');
  });

  it('labels an unnamed tool result', () => {
    const out = messagesToPrompt([
      { role: 'user', content: 'go' },
      { role: 'tool', content: 'done' },
    ]);
    expect(out).toContain('Tool result:');
  });
});
