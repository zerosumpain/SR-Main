import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/models/settings', () => ({
  getOpenRouterApiKey: vi.fn(async () => 'or-test-key'),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    apiKey: string;
    baseURL: string;
    // installUsageCapture wraps chat.completions.create, so the mock client
    // must expose it as a bindable function.
    chat = { completions: { create: async () => ({}) } };
    constructor(opts: { apiKey: string; baseURL: string }) {
      this.apiKey = opts.apiKey;
      this.baseURL = opts.baseURL;
    }
  },
}));

import { getLLMClient, clearLLMClientCache } from '$lib/jkai/llm-client';
import { getOpenRouterApiKey } from '$lib/server/models/settings';

describe('getLLMClient', () => {
  beforeEach(() => {
    clearLLMClientCache();
    vi.clearAllMocks();
  });

  it('returns an OpenRouter client and the requested model', async () => {
    const { client, model } = await getLLMClient({
      provider: 'openrouter',
      modelId: 'anthropic/claude-opus-4',
    });
    expect(client).toBeDefined();
    expect(model).toBe('anthropic/claude-opus-4');
    expect((client as any).apiKey).toBe('or-test-key');
    expect((client as any).baseURL).toBe('https://openrouter.ai/api/v1');
  });

  it('caches the OpenRouter client on repeated calls', async () => {
    const first = await getLLMClient({ provider: 'openrouter', modelId: 'a/b' });
    const second = await getLLMClient({ provider: 'openrouter', modelId: 'c/d' });
    expect(first.client).toBe(second.client);
    // Model changes per call, even on cache hit
    expect(second.model).toBe('c/d');
    expect(getOpenRouterApiKey).toHaveBeenCalledTimes(1);
  });

  it('maps legacy bare GLM ids onto their z-ai/* OpenRouter slugs', async () => {
    const { model } = await getLLMClient({ provider: 'openrouter', modelId: 'glm-5.2' });
    expect(model).toBe('z-ai/glm-5.2');
  });

  it('coerces legacy zai contexts (old DB rows) instead of throwing', async () => {
    const { client, model } = await getLLMClient({
      provider: 'zai' as any,
      modelId: 'glm-5-turbo',
    });
    expect((client as any).baseURL).toBe('https://openrouter.ai/api/v1');
    expect(model).toBe('z-ai/glm-5-turbo');
  });

  it('passes unknown model ids through verbatim', async () => {
    const { model } = await getLLMClient({ provider: 'openrouter', modelId: 'vendor/new-model' });
    expect(model).toBe('vendor/new-model');
  });

  it('throws when OpenRouter API key missing', async () => {
    vi.mocked(getOpenRouterApiKey).mockResolvedValueOnce(undefined);
    clearLLMClientCache();
    await expect(
      getLLMClient({ provider: 'openrouter', modelId: 'a/b' }),
    ).rejects.toThrow('OpenRouter API key not configured');
  });

  it('clearLLMClientCache forces a key re-read', async () => {
    await getLLMClient({ provider: 'openrouter', modelId: 'a/b' });
    expect(getOpenRouterApiKey).toHaveBeenCalledTimes(1);

    clearLLMClientCache();

    await getLLMClient({ provider: 'openrouter', modelId: 'a/b' });
    expect(getOpenRouterApiKey).toHaveBeenCalledTimes(2);
  });
});
