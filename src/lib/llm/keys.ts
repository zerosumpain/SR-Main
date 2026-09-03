import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import OpenAI from 'openai';
import { installUsageCapture } from '$lib/llm/usage-capture';
import { env as dynamicEnv } from '$env/dynamic/private';

const KEYS_PATH = join(process.cwd(), 'keys.json');

export interface DeepDiveKeys {
  tavilyApiKey?: string;
  openrouterApiKey?: string;
  openrouterFallbackModel?: string;
  embeddingModel?: string;
  elevenlabsApiKey?: string;
}

export function loadKeys(): DeepDiveKeys {
  const fileKeys: DeepDiveKeys = (() => {
    if (!existsSync(KEYS_PATH)) return {};
    try {
      return JSON.parse(readFileSync(KEYS_PATH, 'utf-8')) as DeepDiveKeys;
    } catch {
      return {};
    }
  })();

  // Env vars fill in any keys the file didn't provide. A populated
  // keys.json still takes precedence when both are set.
  //
  // Read through `$env/dynamic/private`, not bare `process.env`: Vite loads
  // `.env` into its own env object and does NOT copy it into `process.env`, so
  // a key that lived only in `.env` read as "not configured" in dev while
  // working fine in production (where systemd/docker set real process env).
  // That asymmetry made TAVILY_API_KEY invisible to every local research run.
  // `$env/dynamic/private` reads both, so dev and prod finally agree.
  const env = { ...process.env, ...dynamicEnv };
  return {
    tavilyApiKey: fileKeys.tavilyApiKey ?? env.TAVILY_API_KEY,
    openrouterApiKey: fileKeys.openrouterApiKey ?? env.OPENROUTER_API_KEY,
    openrouterFallbackModel: fileKeys.openrouterFallbackModel ?? env.OPENROUTER_FALLBACK_MODEL,
    embeddingModel: fileKeys.embeddingModel ?? env.EMBEDDING_MODEL,
    elevenlabsApiKey: fileKeys.elevenlabsApiKey ?? env.ELEVENLABS_API_KEY,
  };
}

export function saveKeys(keys: DeepDiveKeys): void {
  writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2), 'utf-8');
}

export function getTavilyKey(): string {
  const keys = loadKeys();
  if (!keys.tavilyApiKey) throw new Error('Tavily API key not configured');
  return keys.tavilyApiKey;
}

/**
 * The OpenRouter key, from the one place production actually keeps it.
 *
 * `loadKeys()` reads keys.json and the environment and nothing else.
 * Production keeps the key in the `openrouter.api_key` app setting instead —
 * there is no keys.json holding one in /opt/strange-rambling-svelte, and its
 * .env has no OPENROUTER_API_KEY — so every caller that asked `loadKeys()` for
 * it got `undefined` while jkai chat, which goes through the gateway and
 * `getOpenRouterApiKey()`, worked fine. That split is what failed every
 * pinned-model research tier with "OpenRouter API key not configured" and
 * silently turned off every research embedding, for a fortnight, on prod only:
 * homeserv's keys.json DOES hold a key, so it never reproduced locally.
 *
 * Async, and a dynamic import, because server/models/settings imports this
 * module — a static import would close the cycle at module-evaluation time.
 * The setting is read through `getSetting`'s 30s cache, so this is not a
 * database round trip per call.
 *
 * The DB read is best-effort on purpose. A host with no database (a script, a
 * test) still resolves the key from keys.json or the environment, which is
 * exactly what this function did before.
 */
export async function getOpenRouterKey(): Promise<string | undefined> {
  try {
    const { getOpenRouterApiKey } = await import('$lib/server/models/settings');
    const key = await getOpenRouterApiKey();
    if (key) return key;
  } catch {
    // No database on this host, or it is down. Fall through to file + env.
  }
  return loadKeys().openrouterApiKey;
}

export async function getOpenRouterClient(): Promise<OpenAI> {
  const apiKey = await getOpenRouterKey();
  if (!apiKey) throw new Error('OpenRouter API key not configured');
  // Wrapped so usage is cost-captured. This comment used to say embeddings were
  // NOT captured through this client; that stopped being true when
  // `installUsageCapture` started calling `installEmbeddingCapture` itself, and
  // a stale note claiming spend is invisible sends the next reader chasing a
  // gap that is already closed.
  return installUsageCapture(
    new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    }),
    'openrouter',
  );
}

// Research embedding space: text-embedding-3-large reduced to 1536 dims via the
// `dimensions` param (see EMBEDDING_DIM in ./ai). 3-large@1536 out-retrieves
// 3-small@1536 while keeping the existing pgvector(1536) columns. This is the
// SHARED space for facts + source chunks + queries — changing it requires
// re-embedding the whole research corpus. (Distinct from the @files index, which
// pins its own model in $lib/file-index/embed.)
export function getEmbeddingModel(): string {
  const keys = loadKeys();
  return keys.embeddingModel || 'openai/text-embedding-3-large';
}

/** Returns the OpenRouter model used as a rate-limit/timeout fallback when the
 *  primary model is limited or slow. Default = Gemini 3.1 Flash Lite (preview):
 *  fast + cheap, ideal for a degraded-availability fallback.
 *  MUST be a live OpenRouter id — a dead id makes failover die silently (the
 *  previous anthropic/claude-3-5-haiku default was REMOVED by OpenRouter and
 *  broke every fallback until caught on 2026-07-11). Verified live 2026-07-14. */
export function getFallbackModel(): string {
  return loadKeys().openrouterFallbackModel || 'google/gemini-3.1-flash-lite-preview';
}

/** True when an OpenRouter API key is configured (fallback is available). */
export async function hasOpenRouter(): Promise<boolean> {
  return !!(await getOpenRouterKey());
}

export async function getKeysStatus(): Promise<{
  tavilyConfigured: boolean;
  openrouterConfigured: boolean;
  elevenlabsConfigured: boolean;
  fallbackModel: string;
  embeddingModel: string;
}> {
  const keys = loadKeys();
  return {
    tavilyConfigured: !!keys.tavilyApiKey,
    // Not `keys.openrouterApiKey` — the key normally lives in the DB, and a
    // status that reads only the file reported "Not set" for a working key.
    openrouterConfigured: !!(await getOpenRouterKey()),
    elevenlabsConfigured: !!keys.elevenlabsApiKey,
    fallbackModel: getFallbackModel(),
    embeddingModel: keys.embeddingModel || 'openai/text-embedding-3-large',
  };
}
