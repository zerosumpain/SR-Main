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
