import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/models/settings', () => ({
  getOpenRouterApiKey: vi.fn(async () => 'or-test-key'),
  getCodexBridgeUrl: () => 'http://127.0.0.1:5207',
  // Off by default, so every test below keeps the meaning it had before the
  // Codex fallback existed: with Codex disabled, a missing key still throws
  // rather than quietly routing somewhere else. The fallback tests turn it on.
  isCodexEnabled: vi.fn(async () => false),
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

import {
  getLLMClient,
  clearLLMClientCache,
  isCreditOrAuthFailure,
  openrouterIsDown,
  markOpenrouterDown,
  codexCanStandIn,
} from '$lib/jkai/llm-client';
import { isEmbeddingModelId } from '$lib/constants/default-models';
import { getOpenRouterApiKey, isCodexEnabled } from '$lib/server/models/settings';

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

// ── The OpenRouter → Codex fallback ────────────────────────────────────────
//
// One key funds every non-Codex model, so running out of credit is a
// simultaneous outage of every OpenRouter-pinned workload rather than a
// degradation. Seen live 2026-08-27: extraction, the doctor, self-improvement
// and the heartbeat's chat continuation all returned 402 at once, and email
// admission could not run.
//
// The two properties that matter most are both about NOT falling back.

describe('classifying an OpenRouter failure', () => {
  it('treats out-of-credit and bad-key as an outage', () => {
    expect(isCreditOrAuthFailure({ status: 402 })).toBe(true);
    expect(isCreditOrAuthFailure({ status: 401 })).toBe(true);
    expect(isCreditOrAuthFailure({ status: 403 })).toBe(true);
  });

  it('does NOT treat rate limiting as an outage', () => {
    // 429 clears on its own. Latching it would move steady traffic onto a
    // finite Codex quota for five minutes at a time.
    expect(isCreditOrAuthFailure({ status: 429 })).toBe(false);
  });

  it('ignores ordinary errors', () => {
    expect(isCreditOrAuthFailure({ status: 400 })).toBe(false);
    expect(isCreditOrAuthFailure({ status: 500 })).toBe(false);
    expect(isCreditOrAuthFailure(new Error('socket hang up'))).toBe(false);
    expect(isCreditOrAuthFailure(null)).toBe(false);
  });
});

describe('the outage latch', () => {
  beforeEach(() => clearLLMClientCache());

  it('is off until something fails', () => {
    expect(openrouterIsDown()).toBe(false);
  });

  it('holds for a few minutes, then expires so a top-up is picked up', () => {
    const now = 1_000_000;
    markOpenrouterDown(now);
    expect(openrouterIsDown(now)).toBe(true);
    expect(openrouterIsDown(now + 4 * 60_000)).toBe(true);
    expect(openrouterIsDown(now + 6 * 60_000)).toBe(false);
  });

  it('is cleared with the client cache', () => {
    markOpenrouterDown();
    expect(openrouterIsDown()).toBe(true);
    clearLLMClientCache();
    expect(openrouterIsDown()).toBe(false);
  });
});

describe('isEmbeddingModelId', () => {
  it('recognises the models actually in use', () => {
    expect(isEmbeddingModelId('openai/text-embedding-3-small')).toBe(true);
    expect(isEmbeddingModelId('openai/text-embedding-3-large')).toBe(true);
  });

  it('does not mistake a chat model for one', () => {
    expect(isEmbeddingModelId('deepseek/deepseek-v4-flash')).toBe(false);
    expect(isEmbeddingModelId('openai/gpt-oss-120b')).toBe(false);
    expect(isEmbeddingModelId('gpt-5.6-terra')).toBe(false);
  });
});

describe('codexCanStandIn', () => {
  // `mockResolvedValue`, never `...Once`: the embedding case below short-circuits
  // BEFORE calling isCodexEnabled, so a queued `Once` there is never consumed and
  // leaks onto the next test — which is exactly how this suite first reported
  // "Codex off" as true and "Codex on" as false, one test out of step.
  beforeEach(() => {
    clearLLMClientCache();
    vi.mocked(isCodexEnabled).mockResolvedValue(false);
  });

  it('refuses embeddings even when Codex is on, without even asking', async () => {
    // The bridge translates chat completions and has no embeddings endpoint, so
    // falling back would replace a true "402 out of credit" with a false 404 and
    // send the next person debugging the wrong thing. Checked before the flag,
    // so no amount of Codex being available can change the answer.
    vi.mocked(isCodexEnabled).mockResolvedValue(true);
    vi.mocked(isCodexEnabled).mockClear();
    expect(await codexCanStandIn('openai/text-embedding-3-small')).toBe(false);
    expect(isCodexEnabled).not.toHaveBeenCalled();
  });

  it('refuses everything when Codex is switched off', async () => {
    // The flag is set only after a health probe; routing to a bridge that is
    // not running swaps one outage for a more confusing one.
    vi.mocked(isCodexEnabled).mockResolvedValue(false);
    expect(await codexCanStandIn('openai/gpt-oss-120b')).toBe(false);
  });

  it('stands in for an ordinary text model', async () => {
    vi.mocked(isCodexEnabled).mockResolvedValue(true);
    expect(await codexCanStandIn('openai/gpt-oss-120b')).toBe(true);
  });
});

describe('routing while OpenRouter is down', () => {
  beforeEach(() => {
    clearLLMClientCache();
    vi.clearAllMocks();
    vi.mocked(getOpenRouterApiKey).mockResolvedValue('or-test-key');
  });

  it('sends a text model to Codex when there is no key at all', async () => {
    vi.mocked(getOpenRouterApiKey).mockResolvedValue(undefined);
    vi.mocked(isCodexEnabled).mockResolvedValue(true);
    const { client, model } = await getLLMClient({ provider: 'openrouter', modelId: 'openai/gpt-oss-120b' });
    expect(model).toBe('gpt-5.6-terra');
    expect((client as any).baseURL).toContain('5207');
  });

  it('sends a text model to Codex while a credit failure is latched', async () => {
    vi.mocked(isCodexEnabled).mockResolvedValue(true);
    markOpenrouterDown();
    const { model } = await getLLMClient({ provider: 'openrouter', modelId: 'openai/gpt-oss-120b' });
    expect(model).toBe('gpt-5.6-terra');
  });

  it('still refuses to send an EMBEDDING model to Codex', async () => {
    vi.mocked(getOpenRouterApiKey).mockResolvedValue(undefined);
    vi.mocked(isCodexEnabled).mockResolvedValue(true);
    await expect(
      getLLMClient({ provider: 'openrouter', modelId: 'openai/text-embedding-3-small' }),
    ).rejects.toThrow('OpenRouter API key not configured');
  });

  it('goes back to OpenRouter once the latch expires', async () => {
    vi.mocked(isCodexEnabled).mockResolvedValue(true);
    markOpenrouterDown(Date.now() - 10 * 60_000);
    const { client, model } = await getLLMClient({ provider: 'openrouter', modelId: 'openai/gpt-oss-120b' });
    expect(model).toBe('openai/gpt-oss-120b');
    expect((client as any).baseURL).toBe('https://openrouter.ai/api/v1');
  });
});
