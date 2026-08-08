import { describe, it, expect } from 'vitest';
import {
  CODEX_MODELS,
  DEFAULT_CODEX_MODEL_SLUG,
  toCodexModelId,
  toCodexSlug,
  isCodexModelId,
  findCodexModel,
} from './codex-catalogue';
import { coerceModelContext } from '$lib/constants/default-models';
import {
  getModelCapabilities,
  getProviderFeatures,
  unsupportedReason,
  siteDefaultBlockReason,
} from './capabilities';
import { priceFor, isSubscriptionProvider } from '$lib/jkai/llm-pricing';

describe('codex model ids', () => {
  it('round-trips slug → id → slug', () => {
    for (const m of CODEX_MODELS) {
      expect(toCodexSlug(toCodexModelId(m.slug))).toBe(m.slug);
    }
  });

  it('does not double-prefix an already-prefixed id', () => {
    expect(toCodexModelId('codex/gpt-5.6-terra')).toBe('codex/gpt-5.6-terra');
  });

  it('recognises only prefixed ids as codex', () => {
    expect(isCodexModelId('codex/gpt-5.6-terra')).toBe(true);
    // The bare slug must NOT read as codex: OpenRouter also serves openai/*
    // models, and a bare id is how legacy rows are stored.
    expect(isCodexModelId('gpt-5.6-terra')).toBe(false);
    expect(isCodexModelId('deepseek/deepseek-v4-flash')).toBe(false);
  });

  it('has a default that exists in the catalogue', () => {
    expect(findCodexModel(DEFAULT_CODEX_MODEL_SLUG)).toBeDefined();
  });
});

describe('coerceModelContext keeps codex picks intact', () => {
  // This is the regression that motivated the change: every resolve*Model()
  // funnels through coerceModelContext, which used to hardcode openrouter, so
  // a saved Codex model came back out as an OpenRouter one.
  it('preserves a prefixed codex id with no provider field', () => {
    expect(coerceModelContext({ modelId: 'codex/gpt-5.6-terra' })).toEqual({
      provider: 'codex',
      modelId: 'codex/gpt-5.6-terra',
    });
  });

  it('normalises provider:codex with a bare slug to a prefixed id', () => {
    expect(coerceModelContext({ provider: 'codex', modelId: 'gpt-5.6-luna' })).toEqual({
      provider: 'codex',
      modelId: 'codex/gpt-5.6-luna',
    });
  });

  it('still maps legacy GLM ids to openrouter', () => {
    expect(coerceModelContext({ provider: 'zai', modelId: 'glm-5.2' })).toEqual({
      provider: 'openrouter',
      modelId: 'z-ai/glm-5.2',
    });
  });

  it('leaves ordinary openrouter ids alone', () => {
    expect(coerceModelContext({ modelId: 'deepseek/deepseek-v4-flash' })).toEqual({
      provider: 'openrouter',
      modelId: 'deepseek/deepseek-v4-flash',
    });
  });
});

describe('codex capabilities', () => {
  it('is text-only', () => {
    const caps = getModelCapabilities({ provider: 'codex', modelId: 'codex/gpt-5.6-sol' });
    expect(caps).toEqual({ image: false, audio: false, video: false, pdf: false, documentText: true });
  });

  it('cannot do tools or embeddings, can stream and do structured output', () => {
    expect(getProviderFeatures('codex')).toEqual({
      tools: false,
      structuredOutput: true,
      streaming: true,
      embeddings: false,
    });
  });

  it('refuses Codex as the site default, but allows OpenRouter', () => {
    // The site default is the fallback for every unpinned role, including the
    // orchestrator's tool-calling loop. Allowing Codex there would break the
    // builder at call time with no obvious cause.
    expect(siteDefaultBlockReason('codex')).not.toBeNull();
    expect(siteDefaultBlockReason('openrouter')).toBeNull();
  });

  it('blames the bridge, not the model, for the tool-calling limit', () => {
    // The first version of this message said Codex "does not support
    // tool-calling", which is false — Hermes drives Codex tool calls over the
    // Responses API daily. The limit is our bridge, which runs the Codex CLI
    // and has nowhere to put caller-supplied schemas. Telling the user an
    // untruth about the model sends them arguing with the wrong thing.
    const reason = siteDefaultBlockReason('codex')!;
    expect(reason).toMatch(/do support tool-calling/);
    expect(reason).toMatch(/bridge/);
    // And it must point at the route that does work.
    expect(reason).toMatch(/conversation|Hermes/);
    expect(unsupportedReason('codex', 'tools')).toMatch(/do tool-calling/);
  });

  it('explains why a role is unavailable', () => {
    expect(unsupportedReason('codex', 'tools')).toMatch(/own toolset/);
    expect(unsupportedReason('codex', 'embeddings')).toMatch(/no embeddings/);
    expect(unsupportedReason('codex', 'streaming')).toBeNull();
    expect(unsupportedReason('openrouter', 'tools')).toBeNull();
  });
});

describe('codex pricing', () => {
  it('prices as null, never zero — a subscription call costs quota, not cash', () => {
    expect(priceFor('codex', 'gpt-5.6-terra')).toBeNull();
  });

  it('is distinguishable from an unknown-model null', () => {
    expect(isSubscriptionProvider('codex')).toBe(true);
    expect(isSubscriptionProvider('openrouter')).toBe(false);
  });
});
