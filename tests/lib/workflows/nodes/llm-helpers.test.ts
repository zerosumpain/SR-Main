import { describe, it, expect, vi } from 'vitest';

// resolveMaxTokens is pure, but the module also exports resolveLLMClient, whose
// imports reach the DB. Stub those so the test loads nothing server-side.
vi.mock('$lib/server/models/settings', () => ({
  resolveDefaultModel: vi.fn().mockResolvedValue({ provider: 'openrouter', modelId: 'test/model' }),
}));
vi.mock('$lib/jkai/llm-client', () => ({
  getLLMClient: vi.fn().mockResolvedValue({ client: {}, model: 'test/model' }),
}));

import { resolveMaxTokens, DEFAULT_NODE_MAX_TOKENS } from '$lib/workflows/nodes/llm-helpers';

describe('resolveMaxTokens', () => {
  it('defaults to 25000 when the node carries no budget', () => {
    expect(DEFAULT_NODE_MAX_TOKENS).toBe(25000);
    expect(resolveMaxTokens(undefined)).toBe(25000);
  });

  it('keeps a deliberate budget, high or low', () => {
    // The 9 LLM nodes in production carry values from 300 to 20000; a default
    // must never overwrite an author's choice.
    expect(resolveMaxTokens(300)).toBe(300);
    expect(resolveMaxTokens(20000)).toBe(20000);
    expect(resolveMaxTokens(60000)).toBe(60000);
  });

  it('falls back on a value that cannot be a budget', () => {
    for (const bad of [0, -1, null, '', 'lots', NaN]) {
      expect(resolveMaxTokens(bad), String(bad)).toBe(DEFAULT_NODE_MAX_TOKENS);
    }
  });

  it('accepts a numeric string and floors a fractional value', () => {
    expect(resolveMaxTokens('4096')).toBe(4096);
    expect(resolveMaxTokens(1024.7)).toBe(1024);
  });
});
