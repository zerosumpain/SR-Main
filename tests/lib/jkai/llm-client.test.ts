import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/deepdive/keys', () => ({
  loadKeys: vi.fn(() => ({
    zaiApiKey: 'test-key-123',
    zaiBaseUrl: 'https://test.api.z.ai/v4/',
    zaiModel: 'test-model',
  })),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    apiKey: string;
    baseURL: string;
    constructor(opts: { apiKey: string; baseURL: string }) {
      this.apiKey = opts.apiKey;
      this.baseURL = opts.baseURL;
    }
  },
}));

import { getLLMClient, clearLLMClientCache } from '$lib/jkai/llm-client';
import { loadKeys } from '$lib/deepdive/keys';

describe('getLLMClient', () => {
  beforeEach(() => {
    clearLLMClientCache();
    vi.clearAllMocks();
  });

  it('returns a client and model', () => {
    const { client, model } = getLLMClient();
    expect(client).toBeDefined();
    expect(model).toBe('test-model');
  });

  it('caches the client on repeated calls', () => {
    const first = getLLMClient();
    const second = getLLMClient();
    expect(first.client).toBe(second.client);
    expect(loadKeys).toHaveBeenCalledTimes(1);
  });

  it('throws when no API key configured', () => {
    vi.mocked(loadKeys).mockReturnValueOnce({ zaiApiKey: '', zaiBaseUrl: '', zaiModel: '' } as any);
    clearLLMClientCache();
    expect(() => getLLMClient()).toThrow('Z.AI API key not configured');
  });

  it('refreshes after clearLLMClientCache', () => {
    getLLMClient();
    clearLLMClientCache();
    getLLMClient();
    expect(loadKeys).toHaveBeenCalledTimes(2);
  });

  it('defaults model to glm-4-plus when not set', () => {
    vi.mocked(loadKeys).mockReturnValueOnce({ zaiApiKey: 'key', zaiBaseUrl: '', zaiModel: '' } as any);
    clearLLMClientCache();
    const { model } = getLLMClient();
    expect(model).toBe('glm-4-plus');
  });

  it('defaults baseURL when not set', () => {
    vi.mocked(loadKeys).mockReturnValueOnce({ zaiApiKey: 'key', zaiBaseUrl: '', zaiModel: 'x' } as any);
    clearLLMClientCache();
    const { client } = getLLMClient();
    expect((client as any).baseURL).toBe('https://api.z.ai/api/coding/paas/v4/');
  });
});
