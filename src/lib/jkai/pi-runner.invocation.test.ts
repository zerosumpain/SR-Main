import { describe, it, expect } from 'vitest';
import { piInvocation, piThinkingLevel } from './pi-runner';

// A build row stores OUR provider names. Pi has its own registry and knows
// none of them: handing it `--provider codex` killed every Codex build on
// startup with `Unknown provider "codex"`.

describe('piInvocation', () => {
  it('sends a Codex build to pi native openai-codex, on the bare slug', () => {
    expect(piInvocation({ provider: 'codex', modelId: 'codex/gpt-5.6-terra' })).toEqual({
      provider: 'openai-codex',
      modelId: 'gpt-5.6-terra',
      apiKeyEnv: null,
    });
  });

  it('recovers Codex from the id alone when the row has no provider', () => {
    // Persisted state carries bare model strings in plenty of places; the
    // `codex/` prefix is the single decider, per coerceModelContext.
    expect(piInvocation({ modelId: 'codex/gpt-5.6-luna' }).provider).toBe('openai-codex');
    expect(piInvocation({ provider: null, modelId: 'codex/gpt-5.5' }).modelId).toBe('gpt-5.5');
  });

  it('asks for no API key on the Codex route — pi holds its own OAuth', () => {
    expect(piInvocation({ provider: 'codex', modelId: 'codex/gpt-5.6-sol' }).apiKeyEnv).toBeNull();
  });

  it('leaves an OpenRouter build alone', () => {
    expect(piInvocation({ provider: 'openrouter', modelId: 'deepseek/deepseek-v4-flash' })).toEqual({
      provider: 'openrouter',
      modelId: 'deepseek/deepseek-v4-flash',
      apiKeyEnv: 'OPENROUTER_API_KEY',
    });
  });

  it('runs a legacy zai row on OpenRouter, with the remapped slug', () => {
    // These rows predate the z.ai decommission. They get the OpenRouter key, so
    // they must also get the OpenRouter provider name and a z-ai/* slug —
    // `--provider zai` plus an OpenRouter key is a credential mismatch.
    expect(piInvocation({ provider: 'zai', modelId: 'glm-5.2' })).toEqual({
      provider: 'openrouter',
      modelId: 'z-ai/glm-5.2',
      apiKeyEnv: 'OPENROUTER_API_KEY',
    });
  });
});

describe('piThinkingLevel', () => {
  it('lifts minimal to low on Codex — the 5.6 line rejects minimal', () => {
    expect(piThinkingLevel('openai-codex', 'minimal')).toBe('low');
  });

  it('passes every other level through, on both providers', () => {
    for (const level of ['off', 'low', 'medium', 'high', 'xhigh', undefined]) {
      expect(piThinkingLevel('openai-codex', level)).toBe(level);
      expect(piThinkingLevel('openrouter', level)).toBe(level);
    }
    expect(piThinkingLevel('openrouter', 'minimal')).toBe('minimal');
  });
});
