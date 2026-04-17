import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({
  db: {
    transaction: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('$lib/db/schema', () => ({
  openrouterModels: {},
}));

vi.mock('$lib/server/models/settings', () => ({
  setSetting: vi.fn(async () => {}),
}));

import { mapOpenRouterModel, deriveProvider } from '$lib/server/models/openrouter-catalogue';

describe('openrouter catalogue mapping', () => {
  it('deriveProvider splits id prefix', () => {
    expect(deriveProvider('anthropic/claude-opus-4')).toBe('anthropic');
    expect(deriveProvider('openai/gpt-5')).toBe('openai');
    expect(deriveProvider('no-slash')).toBe('unknown');
  });

  it('mapOpenRouterModel transforms raw payload', () => {
    const raw = {
      id: 'anthropic/claude-opus-4',
      name: 'Claude Opus 4',
      description: 'Most capable',
      context_length: 200000,
      pricing: { prompt: '0.000015', completion: '0.000075', image: '0.024' },
      architecture: { modality: 'text+image->text' },
    };
    const row = mapOpenRouterModel(raw);
    expect(row).toMatchObject({
      id: 'anthropic/claude-opus-4',
      name: 'Claude Opus 4',
      description: 'Most capable',
      contextLength: 200000,
      promptPrice: '0.000015',
      completionPrice: '0.000075',
      imagePrice: '0.024',
      modality: 'text+image->text',
      provider: 'anthropic',
    });
    expect(row.raw).toEqual(raw);
  });

  it('mapOpenRouterModel handles missing pricing fields', () => {
    const raw = {
      id: 'free/model',
      name: 'Free',
      context_length: 8192,
      pricing: { prompt: '0', completion: '0' },
      architecture: { modality: 'text->text' },
    };
    const row = mapOpenRouterModel(raw);
    expect(row.promptPrice).toBe('0');
    expect(row.completionPrice).toBe('0');
    expect(row.imagePrice).toBeNull();
  });
});
