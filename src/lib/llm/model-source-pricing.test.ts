import { describe, it, expect, vi } from 'vitest';

/**
 * The shared pricing table reads its catalogue through `$lib/llm/model-source`,
 * which is Main's database here and Main's served copy in an application. An
 * unpriced catalogue row must stay unpriced: `Number(null)` is 0, which would
 * book every call to that model as free.
 */
vi.mock('$lib/llm/model-source', () => ({
  loadCatalogue: async () => [
    { id: 'priced/model', promptPrice: 0.000001, completionPrice: 0.000002, maxCompletionTokens: null, inputModalities: null, modality: null, supportedParameters: null },
    { id: 'unpriced/model', promptPrice: null, completionPrice: null, maxCompletionTokens: null, inputModalities: null, modality: null, supportedParameters: null },
    { id: 'free/model', promptPrice: 0, completionPrice: 0, maxCompletionTokens: null, inputModalities: null, modality: null, supportedParameters: null },
  ],
  writeUsage: async () => undefined,
}));

const { priceFor, clearPriceCache } = await import('./pricing');

describe('pricing from the model source', () => {
  it('prices from the catalogue once warm, and never invents a zero', async () => {
    clearPriceCache();
    priceFor('openrouter', 'priced/model'); // starts the warm-up
    await vi.waitFor(() => expect(priceFor('openrouter', 'priced/model')).toEqual({ inputPerMillion: 1, outputPerMillion: 2 }));
    expect(priceFor('openrouter', 'unpriced/model')).toBeNull();
    // A model OpenRouter really lists at zero is free, and says so.
    expect(priceFor('openrouter', 'free/model')).toEqual({ inputPerMillion: 0, outputPerMillion: 0 });
    expect(priceFor('codex', 'gpt-5.6-terra')).toBeNull();
  });
});
