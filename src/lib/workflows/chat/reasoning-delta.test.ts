import { describe, it, expect } from 'vitest';
import { extractReasoningDelta } from './reasoning-delta';

/**
 * Cover for "the Reasoning panel is empty on the in-process loop".
 *
 * The collapsible Reasoning panel is fed by `{type:'thinking'}` JobEvents. Until
 * now the only producer was the Hermes frame adapter ($lib/jkai/sse-adapter),
 * so bypassing Hermes (jkai.chat.hermes_enabled=false) left the panel with no
 * input at all: general-chat's streaming loop read `delta.content` and
 * `delta.tool_calls` and dropped reasoning on the floor.
 *
 * Providers disagree about where reasoning lives on the delta, hence the
 * shapes below — OpenRouter sends `reasoning` (and newer builds
 * `reasoning_details[]`), DeepSeek-style OpenAI-compat endpoints send
 * `reasoning_content`.
 */
describe('extractReasoningDelta', () => {
  it('reads OpenRouter-style `reasoning`', () => {
    expect(extractReasoningDelta({ reasoning: 'Let me check the graph' })).toBe('Let me check the graph');
  });

  it('reads DeepSeek-style `reasoning_content`', () => {
    expect(extractReasoningDelta({ reasoning_content: 'weighing options' })).toBe('weighing options');
  });

  it('reads `reasoning_details[]` entries, joined in order', () => {
    const delta = {
      reasoning_details: [
        { type: 'reasoning.text', text: 'First, ' },
        { type: 'reasoning.text', text: 'then second.' },
      ],
    };
    expect(extractReasoningDelta(delta)).toBe('First, then second.');
  });

  it('reads `summary` and `content` keys inside reasoning_details', () => {
    const delta = { reasoning_details: [{ summary: 'a' }, { content: 'b' }] };
    expect(extractReasoningDelta(delta)).toBe('ab');
  });

  it('unwraps an object-shaped `reasoning`', () => {
    expect(extractReasoningDelta({ reasoning: { text: 'nested' } })).toBe('nested');
  });

  // The whole point is to route reasoning AWAY from the answer bubble. If this
  // ever returned content, the loop would emit the reply twice — once as a
  // thinking delta and once as a token.
  it('never returns the answer content', () => {
    expect(extractReasoningDelta({ content: 'the actual answer' })).toBe('');
  });

  it('prefers one source when a provider sends several, so nothing double-emits', () => {
    const delta = { reasoning: 'canonical', reasoning_content: 'canonical', reasoning_details: [{ text: 'canonical' }] };
    expect(extractReasoningDelta(delta)).toBe('canonical');
  });

  // A frame captured verbatim off the wire from OpenRouter on 2026-08-13, kept
  // because it is the shape the double-emit guard above has to defend against:
  // the SAME text arrives under both `reasoning` and `reasoning_details`, and
  // `content` rides along as an empty string on every reasoning frame.
  //
  // The model it came from is incidental — which model a turn actually uses is
  // whatever the model-selection modal has set (`jkai.chat.default_model`, via
  // resolveDefaultModel), and this extractor is deliberately model-agnostic. It
  // is pinned as a fixture so a provider changing its wire shape fails here
  // rather than silently emptying the Reasoning panel.
  it('handles a real OpenRouter reasoning frame without double-emitting', () => {
    const wire = {
      content: '',
      role: 'assistant',
      reasoning: '1',
      reasoning_details: [{ type: 'reasoning.text', text: '1', format: 'unknown', index: 0 }],
    };
    expect(extractReasoningDelta(wire)).toBe('1');
  });

  it('returns empty string for deltas with no reasoning', () => {
    for (const d of [{}, null, undefined, { tool_calls: [] }, { reasoning: '' }, { reasoning: null }]) {
      expect(extractReasoningDelta(d)).toBe('');
    }
  });

  it('ignores non-string junk rather than stringifying it', () => {
    expect(extractReasoningDelta({ reasoning: 42 })).toBe('');
    expect(extractReasoningDelta({ reasoning: { text: {} } })).toBe('');
    expect(extractReasoningDelta({ reasoning_details: [{ text: 7 }, null, 99] })).toBe('');
  });

  // A bare string among the details is not junk — some builds send them
  // unwrapped — so it is kept while the junk around it is dropped.
  it('keeps bare-string details and skips the junk beside them', () => {
    expect(extractReasoningDelta({ reasoning_details: [{ text: 7 }, 'loose', null] })).toBe('loose');
  });
});
