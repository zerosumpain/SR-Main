import { describe, it, expect } from 'vitest';
import { getModelCapabilities } from '$lib/server/models/capabilities';

describe('getModelCapabilities', () => {
  it('z-ai/glm-5 is text-only, as the catalogue lists it', () => {
    // It said ALL until 2026-09-25; OpenRouter 404s an image sent to it.
    expect(getModelCapabilities({ provider: 'openrouter', modelId: 'z-ai/glm-5' })).toEqual({
      image: false, audio: false, video: false, pdf: false, documentText: true,
    });
  });
  it('z-ai/glm-4.5v is image-only', () => {
    const c = getModelCapabilities({ provider: 'openrouter', modelId: 'z-ai/glm-4.5v' });
    expect(c.image).toBe(true);
    expect(c.audio).toBe(false);
    expect(c.video).toBe(false);
    expect(c.pdf).toBe(false);
    expect(c.documentText).toBe(true);
  });
  it('legacy bare GLM ids map onto their z-ai/* capabilities', () => {
    expect(getModelCapabilities({ provider: 'openrouter', modelId: 'glm-5.2' })).toEqual(
      getModelCapabilities({ provider: 'openrouter', modelId: 'z-ai/glm-5.2' }),
    );
  });
  it('openrouter vision models get image', () => {
    const c = getModelCapabilities({ provider: 'openrouter', modelId: 'anthropic/claude-3.5-sonnet' });
    expect(c.image).toBe(true);
    expect(c.pdf).toBe(true);
  });
  it('unknown openrouter model defaults to text-only', () => {
    const c = getModelCapabilities({ provider: 'openrouter', modelId: 'unknown/weird-model' });
    expect(c).toEqual({
      image: false, audio: false, video: false, pdf: false, documentText: true,
    });
  });
});
