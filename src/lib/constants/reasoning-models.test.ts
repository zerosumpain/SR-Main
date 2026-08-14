import { describe, it, expect } from 'vitest';
import { isReasoningModel } from './default-models';

describe('isReasoningModel', () => {
  it('still matches the families it always did', () => {
    expect(isReasoningModel('deepseek/deepseek-v4-flash')).toBe(true);
    expect(isReasoningModel('deepseek/deepseek-r1')).toBe(true);
    expect(isReasoningModel('minimax/minimax-m2')).toBe(true);
    expect(isReasoningModel('qwen/qwq-32b')).toBe(true);
    expect(isReasoningModel('openai/o3-mini')).toBe(true);
  });

  it('sees through an OpenRouter ~latest alias', () => {
    // The tilde alone defeated every startsWith, so the floor never lifted and
    // the model spent its whole 350-token budget thinking. All three
    // "(empty heartbeat reply)" rows in 30 days were unmatched models.
    expect(isReasoningModel('~deepseek/deepseek-v4-flash-latest')).toBe(true);
  });

  it('covers the other two families observed returning empty replies', () => {
    expect(isReasoningModel('moonshotai/kimi-k3')).toBe(true);
    expect(isReasoningModel('tencent/hy3-preview')).toBe(true);
  });

  it('matches Codex models by their bare slug', () => {
    // `toCodexSlug` strips the `codex/` prefix before a request is built, so
    // the bare form is what actually reaches the predicate.
    expect(isReasoningModel('gpt-5.6-sol')).toBe(true);
    expect(isReasoningModel('gpt-5.6-terra')).toBe(true);
    expect(isReasoningModel('openai/gpt-5.6-sol')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isReasoningModel('DeepSeek/DeepSeek-V4-Flash')).toBe(true);
  });

  it('leaves plainly non-reasoning models alone', () => {
    expect(isReasoningModel('mistralai/mistral-small')).toBe(false);
    expect(isReasoningModel('openai/gpt-4o-mini')).toBe(false);
  });

  /**
   * Gemini 3.x Flash was previously asserted here as NON-reasoning. It is not.
   *
   * Measured 2026-08-14 on a research synthesis against
   * `google/gemini-3.5-flash`: the stream carried 3,251 characters of
   * `delta.reasoning` and produced a 421-character answer from a 2,000-token
   * cap — the answer began mid-sentence because thinking had already consumed
   * the budget. It bills like a cheap fast model and spends like a reasoning
   * one, which is exactly the combination the floor exists to catch.
   */
  it('treats the gemini-3 flash family as reasoning, on measured evidence', () => {
    expect(isReasoningModel('google/gemini-3.5-flash')).toBe(true);
    expect(isReasoningModel('google/gemini-3.1-flash-lite-preview')).toBe(true);
    expect(isReasoningModel('~google/gemini-3.5-flash')).toBe(true);
    // Older Gemini generations are untested here and stay out of the predicate.
    expect(isReasoningModel('google/gemini-2.0-flash')).toBe(false);
  });
});
