import { describe, it, expect } from 'vitest';
import {
  CODEX_MODELS,
  CODEX_REASONING_EFFORTS,
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
import { priceFor, isSubscriptionProvider } from '$lib/llm/pricing';
import { CODEX_EFFORT_CEILING, thinkingLevelsFor } from '$lib/models/thinking';

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

describe('codex reasoning ceilings', () => {
  // The ceiling table cannot live beside the catalogue — the chat picker reads
  // it in the browser and `$lib/server/*` cannot cross that boundary — so this
  // is the seam where the two hand-maintained lists are held together. Adding a
  // model without a ceiling would silently offer it `xhigh` and no more.
  it('gives every catalogued model a ceiling, and names no model that is gone', () => {
    expect(Object.keys(CODEX_EFFORT_CEILING).sort()).toEqual(CODEX_MODELS.map((m) => m.slug).sort());
  });

  it('names only efforts the bridge will forward', () => {
    for (const effort of Object.values(CODEX_EFFORT_CEILING)) {
      expect(CODEX_REASONING_EFFORTS).toContain(effort);
    }
  });

  it('lets the default model reason as deep as it can', () => {
    expect(thinkingLevelsFor('codex', DEFAULT_CODEX_MODEL_SLUG)).toContain('ultra');
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

  it('does tools and structured output and streaming; embeddings remain the gap', () => {
    expect(getProviderFeatures('codex')).toEqual({
      tools: true,
      structuredOutput: true,
      streaming: true,
      embeddings: false,
    });
  });

  it('allows Codex as the site default now that tool-calling works', () => {
    // This was blocked while the bridge could not pass tool schemas — the site
    // default feeds the orchestrator and builder, which would have failed at
    // call time. The bridge now publishes caller tools over MCP, so the block
    // is gone. Speed is the operator's trade to make, not a capability gate.
    expect(siteDefaultBlockReason('codex')).toBeNull();
    expect(siteDefaultBlockReason('openrouter')).toBeNull();
  });

  it('still refuses Codex for embeddings, with the reason', () => {
    expect(unsupportedReason('codex', 'embeddings')).toMatch(/no embeddings/);
    expect(unsupportedReason('codex', 'tools')).toBeNull();
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
