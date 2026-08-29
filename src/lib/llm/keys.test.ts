import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// The two stores. Production keeps the OpenRouter key in the
// `openrouter.api_key` app setting; keys.json and OPENROUTER_API_KEY are the
// developer-box fallback. Everything here is about which one answers, because
// reading only the file is what broke research on prod while jkai chat — which
// reads the setting — carried on working.
// ---------------------------------------------------------------------------

let fileContents: string | null = null;
let dbKey: string | undefined;
let dbThrows = false;

vi.mock('fs', () => ({
  existsSync: () => fileContents !== null,
  readFileSync: () => fileContents ?? '',
  writeFileSync: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('$lib/server/models/settings', () => ({
  getOpenRouterApiKey: vi.fn(async () => {
    if (dbThrows) throw new Error('no database on this host');
    return dbKey;
  }),
}));

vi.mock('$lib/llm/usage-capture', () => ({ installUsageCapture: (c: unknown) => c }));

const { getOpenRouterKey, getOpenRouterClient, hasOpenRouter, getKeysStatus, loadKeys } =
  await import('./keys');

beforeEach(() => {
  fileContents = null;
  dbKey = undefined;
  dbThrows = false;
  delete process.env.OPENROUTER_API_KEY;
});

describe('getOpenRouterKey', () => {
  it('prefers the app setting over keys.json', async () => {
    dbKey = 'sk-or-from-db';
    fileContents = JSON.stringify({ openrouterApiKey: 'sk-or-from-file' });
    expect(await getOpenRouterKey()).toBe('sk-or-from-db');
  });

  it('falls back to keys.json when the setting is unset', async () => {
    dbKey = undefined;
    fileContents = JSON.stringify({ openrouterApiKey: 'sk-or-from-file' });
    expect(await getOpenRouterKey()).toBe('sk-or-from-file');
  });

  it('falls back to the environment when neither the setting nor the file has one', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-from-env';
    expect(await getOpenRouterKey()).toBe('sk-or-from-env');
  });

  // A script or a test host has no database. Before, that was fine because
  // nothing here touched one; now it must stay fine.
  it('falls back to the file when the settings lookup throws', async () => {
    dbThrows = true;
    fileContents = JSON.stringify({ openrouterApiKey: 'sk-or-from-file' });
    expect(await getOpenRouterKey()).toBe('sk-or-from-file');
  });

  it('is undefined when no store has one', async () => {
    expect(await getOpenRouterKey()).toBeUndefined();
  });
});

describe('the consumers of the key', () => {
  // This is the production shape exactly: the key is in the DB, keys.json holds
  // something else entirely, and .env has nothing.
  it('builds a client from the app setting alone', async () => {
    dbKey = 'sk-or-from-db';
    fileContents = JSON.stringify({ provider: 'openrouter', modelId: 'openai/gpt-5.6-luna' });

    expect(loadKeys().openrouterApiKey).toBeUndefined();
    await expect(getOpenRouterClient()).resolves.toBeTruthy();
    expect(await hasOpenRouter()).toBe(true);
    expect((await getKeysStatus()).openrouterConfigured).toBe(true);
  });

  it('still refuses to build a client when no store has a key', async () => {
    await expect(getOpenRouterClient()).rejects.toThrow('OpenRouter API key not configured');
    expect(await hasOpenRouter()).toBe(false);
    expect((await getKeysStatus()).openrouterConfigured).toBe(false);
  });
});
