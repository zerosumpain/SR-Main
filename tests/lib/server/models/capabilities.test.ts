import { describe, it, expect } from 'vitest';
import { getModelCapabilities } from '$lib/server/models/capabilities';

describe('getModelCapabilities', () => {
  it('glm-5 supports everything', () => {
    expect(getModelCapabilities({ provider: 'zai', modelId: 'glm-5' })).toEqual({
      image: true, audio: true, video: true, pdf: true, documentText: true,
    });
  });
  it('glm-4.5v is image-only', () => {
    const c = getModelCapabilities({ provider: 'zai', modelId: 'glm-4.5v' });
    expect(c.image).toBe(true);
    expect(c.audio).toBe(false);
    expect(c.video).toBe(false);
    expect(c.pdf).toBe(false);
    expect(c.documentText).toBe(true);
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
