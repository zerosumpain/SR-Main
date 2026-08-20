import { describe, it, expect } from 'vitest';
import { getModelCapabilities, getChatInputCapabilities } from './capabilities';

const CODEX = { provider: 'codex', modelId: 'codex/gpt-5.6-terra' } as const;
const TEXT_ONLY_OPENROUTER = { provider: 'openrouter', modelId: 'deepseek/deepseek-v4-flash' } as const;
const MULTIMODAL = { provider: 'openrouter', modelId: 'z-ai/glm-5.1' } as const;

describe('getModelCapabilities', () => {
  it('still reports Codex as text-only — the picker must stay truthful about the model', () => {
    expect(getModelCapabilities(CODEX).image).toBe(false);
  });
});

describe('getChatInputCapabilities', () => {
  it('accepts every kind on the Hermes lane, whatever the model says', () => {
    // Hermes owns media handling: an image goes to the model natively when it
    // does vision and through the auxiliary vision model as a description when
    // it doesn't. Gating on the model here is what dropped every image John
    // attached to a Codex conversation before it was ever sent.
    expect(getChatInputCapabilities(CODEX, { hermes: true })).toEqual({
      image: true, audio: true, video: true, pdf: true, documentText: true,
    });
    expect(getChatInputCapabilities(TEXT_ONLY_OPENROUTER, { hermes: true }).image).toBe(true);
  });

  it('falls back to the model when the legacy in-process lane is serving chat', () => {
    // That lane builds the content parts itself, so the model's own limits are
    // the real ones.
    expect(getChatInputCapabilities(CODEX, { hermes: false }).image).toBe(false);
    expect(getChatInputCapabilities(TEXT_ONLY_OPENROUTER, { hermes: false }).image).toBe(false);
    expect(getChatInputCapabilities(MULTIMODAL, { hermes: false }).image).toBe(true);
  });
});
