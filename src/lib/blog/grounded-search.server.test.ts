import { beforeEach, describe, expect, it, vi } from 'vitest';

const { groundedCompletion, resolveResearchFastModel } = vi.hoisted(() => ({
  groundedCompletion: vi.fn(),
  resolveResearchFastModel: vi.fn(),
}));

vi.mock('$lib/deepdive/ai', () => ({ groundedCompletion }));
vi.mock('$lib/server/models/workload-settings', () => ({ resolveResearchFastModel }));

import { groundedSourceSearch } from './grounded-search.server';

describe('groundedSourceSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    groundedCompletion.mockResolvedValue({
      text: 'The retrieved sources agree on the material point.',
      citations: [
        { url: 'https://example.gov.uk/report', title: 'Official report' },
        { url: 'https://example.gov.uk/report', title: 'Duplicate annotation' },
        { url: 'https://example.edu/study' },
      ],
    });
  });

  it('uses Instant research free grounding for a Codex research-fast model', async () => {
    resolveResearchFastModel.mockResolvedValue({ modelId: 'codex/gpt-5.6-terra' });

    const results = await groundedSourceSearch('published result', 'The result was published');

    expect(groundedCompletion).toHaveBeenCalledWith(
      expect.stringContaining('Search the live web'),
      expect.stringContaining('CLAIM: The result was published'),
      expect.objectContaining({ mode: 'free', model: 'codex/gpt-5.6-terra' }),
    );
    expect(results).toEqual([
      expect.objectContaining({ url: 'https://example.gov.uk/report', title: 'Official report' }),
      expect.objectContaining({ url: 'https://example.edu/study', title: 'example.edu' }),
    ]);
  });

  it('uses Instant research fast web grounding for an OpenRouter model', async () => {
    resolveResearchFastModel.mockResolvedValue({ modelId: 'openai/gpt-5.6-luna' });

    await groundedSourceSearch('published result');

    expect(groundedCompletion).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('published result'),
      expect.objectContaining({ mode: 'fast', model: 'openai/gpt-5.6-luna' }),
    );
  });
});
