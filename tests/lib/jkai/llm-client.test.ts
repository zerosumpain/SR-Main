import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/deepdive/keys', () => ({
  loadKeys: vi.fn(() => ({
    zaiApiKey: 'test-key-123',
    zaiBaseUrl: 'https://test.api.z.ai/v4/',
    zaiModel: 'test-model',
  })),
}));

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
import { loadKeys } from '$lib/deepdive/keys';
import { getOpenRouterApiKey } from '$lib/server/models/settings';

describe('getLLMClient', () => {
  beforeEach(() => {
    clearLLMClientCache();
    vi.clearAllMocks();
  });

  it('returns a Z.AI client and the requested model', async () => {
    const { client, model } = await getLLMClient({ provider: 'zai', modelId: 'glm-5.1' });
    expect(client).toBeDefined();
    expect(model).toBe('glm-5.1');
    expect((client as any).apiKey).toBe('test-key-123');
    expect((client as any).baseURL).toBe('https://test.api.z.ai/v4/');
  });

  it('caches the Z.AI client on repeated calls', async () => {
    const first = await getLLMClient({ provider: 'zai', modelId: 'glm-5.1' });
    const second = await getLLMClient({ provider: 'zai', modelId: 'glm-4-plus' });
    expect(first.client).toBe(second.client);
    // Model changes per call, even on cache hit
    expect(second.model).toBe('glm-4-plus');
    expect(loadKeys).toHaveBeenCalledTimes(1);
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
    expect(second.model).toBe('c/d');
    expect(getOpenRouterApiKey).toHaveBeenCalledTimes(1);
  });

  it('caches Z.AI and OpenRouter clients independently', async () => {
    const zai = await getLLMClient({ provider: 'zai', modelId: 'glm-5.1' });
    const or = await getLLMClient({ provider: 'openrouter', modelId: 'a/b' });
    expect(zai.client).not.toBe(or.client);
  });

  it('throws when Z.AI API key missing', async () => {
    vi.mocked(loadKeys).mockReturnValueOnce({
      zaiApiKey: '',
      zaiBaseUrl: '',
      zaiModel: '',
    } as any);
    clearLLMClientCache();
    await expect(
      getLLMClient({ provider: 'zai', modelId: 'glm-5.1' }),
    ).rejects.toThrow('Z.AI API key not configured');
  });

  it('throws when OpenRouter API key missing', async () => {
    vi.mocked(getOpenRouterApiKey).mockResolvedValueOnce(undefined);
    clearLLMClientCache();
    await expect(
      getLLMClient({ provider: 'openrouter', modelId: 'a/b' }),
    ).rejects.toThrow('OpenRouter API key not configured');
  });

  it('throws on unknown provider', async () => {
    await expect(
      getLLMClient({ provider: 'bogus' as any, modelId: 'x' }),
    ).rejects.toThrow('Unknown provider: bogus');
  });

  it('clearLLMClientCache clears both providers', async () => {
    await getLLMClient({ provider: 'zai', modelId: 'glm-5.1' });
    await getLLMClient({ provider: 'openrouter', modelId: 'a/b' });
    expect(loadKeys).toHaveBeenCalledTimes(1);
    expect(getOpenRouterApiKey).toHaveBeenCalledTimes(1);

    clearLLMClientCache();

    await getLLMClient({ provider: 'zai', modelId: 'glm-5.1' });
    await getLLMClient({ provider: 'openrouter', modelId: 'a/b' });
    expect(loadKeys).toHaveBeenCalledTimes(2);
    expect(getOpenRouterApiKey).toHaveBeenCalledTimes(2);
  });

  it('defaults Z.AI baseURL when not configured', async () => {
    vi.mocked(loadKeys).mockReturnValueOnce({
      zaiApiKey: 'key',
      zaiBaseUrl: '',
      zaiModel: 'x',
    } as any);
    clearLLMClientCache();
    const { client } = await getLLMClient({ provider: 'zai', modelId: 'glm-5.1' });
    expect((client as any).baseURL).toBe('https://api.z.ai/api/coding/paas/v4/');
  });
});
