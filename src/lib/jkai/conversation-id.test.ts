import { describe, it, expect } from 'vitest';
import { normaliseConversationId, normaliseOptionalConversationId } from './conversation-id';

describe('normaliseConversationId', () => {
  it('strips the Hermes chat_ prefix', () => {
    expect(normaliseConversationId('chat_67e007d3-67fc-42ac-8421-4da8ab210e30')).toBe(
      '67e007d3-67fc-42ac-8421-4da8ab210e30',
    );
  });

  it('leaves a bare uuid alone', () => {
    expect(normaliseConversationId('67e007d3-67fc-42ac-8421-4da8ab210e30')).toBe(
      '67e007d3-67fc-42ac-8421-4da8ab210e30',
    );
  });

  it('is idempotent — double-stripping is harmless', () => {
    const once = normaliseConversationId('chat_abc');
    expect(normaliseConversationId(once)).toBe('abc');
  });

  it('only strips a leading occurrence', () => {
    expect(normaliseConversationId('x_chat_abc')).toBe('x_chat_abc');
  });

  it('maps nullish to undefined rather than the string "undefined"', () => {
    expect(normaliseOptionalConversationId(null)).toBeUndefined();
    expect(normaliseOptionalConversationId(undefined)).toBeUndefined();
    expect(normaliseOptionalConversationId('')).toBeUndefined();
    expect(normaliseOptionalConversationId('chat_abc')).toBe('abc');
  });
});
