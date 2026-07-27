import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory store backing the mocked DB
const store = new Map<string, unknown>();

vi.mock('$lib/db', () => {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            const key = lastWhereKey;
            if (!store.has(key)) return [];
            return [{ key, value: store.get(key), updatedAt: new Date() }];
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: { key: string; value: unknown }) => ({
        onConflictDoUpdate: vi.fn(async (_opts: unknown) => {
          store.set(row.key, row.value);
        }),
      })),
    })),
  };
  return { db };
});

vi.mock('$lib/db/schema', () => ({
  appSettings: {
    key: { name: 'key', __symbol: 'key' },
    value: { name: 'value' },
    updatedAt: { name: 'updatedAt' },
  },
}));

// Capture the key passed to eq() so the mocked `where` can use it
let lastWhereKey = '';
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (_col: unknown, val: string) => {
      lastWhereKey = val;
      return { __eq: val };
    },
  };
});

vi.mock('$lib/deepdive/keys', () => ({
  loadKeys: vi.fn(() => ({ openrouterApiKey: 'sk-or-from-keys-json' })),
}));

import {
  getSetting,
  setSetting,
  resolveDefaultModel,
  resolveChatAltOpenRouterModel,
  getOpenRouterApiKey,
  clearSettingsCache,
} from '$lib/server/models/settings';
import { loadKeys } from '$lib/deepdive/keys';

describe('app_settings helpers', () => {
  beforeEach(() => {
    clearSettingsCache();
    store.clear();
    store.set('jkai.chat.default_model', { provider: 'openrouter', modelId: 'z-ai/glm-5-turbo' });
    vi.mocked(loadKeys).mockReturnValue({ openrouterApiKey: 'sk-or-from-keys-json' });
  });

  it('getSetting returns typed value', async () => {
    const v = await getSetting<{ modelId: string }>('jkai.chat.default_model');
    expect(v).toEqual({ provider: 'openrouter', modelId: 'z-ai/glm-5-turbo' });
  });

  it('setSetting upserts and invalidates cache', async () => {
    await setSetting('jkai.chat.default_model', { provider: 'openrouter', modelId: 'z-ai/glm-5.1' });
    clearSettingsCache();
    const v = await getSetting<{ modelId: string }>('jkai.chat.default_model');
    expect(v).toEqual({ provider: 'openrouter', modelId: 'z-ai/glm-5.1' });
  });

  it("resolveDefaultModel() returns the configured model", async () => {
    await setSetting('jkai.chat.default_model', { provider: 'openrouter', modelId: 'z-ai/glm-5.1' });
    clearSettingsCache();
    const ctx = await resolveDefaultModel();
    expect(ctx).toEqual({ provider: 'openrouter', modelId: 'z-ai/glm-5.1' });
  });

  it("resolveDefaultModel() falls back to the code default when unset", async () => {
    store.delete('jkai.chat.default_model');
    clearSettingsCache();
    const ctx = await resolveDefaultModel();
    expect(ctx).toEqual({ provider: 'openrouter', modelId: 'deepseek/deepseek-v4-flash' });
  });

  it("ignores a stray jkai.builder.default_model — one default drives every task", async () => {
    // The key was retired in 2026-07-25's consolidation and the row is gone, but
    // an old backup restore or a hand-written setting could put it back. Nothing
    // should start reading it again without this failing first.
    await setSetting('jkai.chat.default_model', { provider: 'openrouter', modelId: 'z-ai/glm-5.1' });
    store.set('jkai.builder.default_model', { provider: 'openrouter', modelId: 'z-ai/glm-5-turbo' });
    clearSettingsCache();
    expect(await resolveDefaultModel()).toEqual({ provider: 'openrouter', modelId: 'z-ai/glm-5.1' });
  });

  it("resolveDefaultModel() coerces a stored legacy bare GLM id", async () => {
    store.set('jkai.chat.default_model', { modelId: 'glm-5.2' });
    clearSettingsCache();
    const ctx = await resolveDefaultModel();
    expect(ctx).toEqual({ provider: 'openrouter', modelId: 'z-ai/glm-5.2' });
  });

  it('resolveChatAltOpenRouterModel returns null when unset', async () => {
    store.set('jkai.chat.alt_openrouter_model', null);
    clearSettingsCache();
    const ctx = await resolveChatAltOpenRouterModel();
    expect(ctx).toBeNull();
  });

  it('resolveChatAltOpenRouterModel returns an openrouter ctx when set', async () => {
    await setSetting('jkai.chat.alt_openrouter_model', { modelId: 'anthropic/claude-opus-4' });
    clearSettingsCache();
    const ctx = await resolveChatAltOpenRouterModel();
    expect(ctx).toEqual({ provider: 'openrouter', modelId: 'anthropic/claude-opus-4' });
  });

  it('getOpenRouterApiKey prefers DB over keys.json when DB value is set', async () => {
    await setSetting('openrouter.api_key', { value: 'sk-or-db-value' });
    clearSettingsCache();
    const key = await getOpenRouterApiKey();
    expect(key).toBe('sk-or-db-value');
  });

  it('getOpenRouterApiKey falls back to keys.json when DB value is empty', async () => {
    await setSetting('openrouter.api_key', { value: '' });
    clearSettingsCache();
    const key = await getOpenRouterApiKey();
    expect(key).toBe('sk-or-from-keys-json');
  });
});
