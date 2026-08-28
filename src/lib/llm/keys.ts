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

export function getOpenRouterClient(): OpenAI {
  const keys = loadKeys();
  if (!keys.openrouterApiKey) throw new Error('OpenRouter API key not configured');
  // Wrapped so CHAT usage is cost-captured. Embeddings via this client are
  // still uncaptured — installUsageCapture only patches chat.completions.create,
  // not embeddings.create.
  return installUsageCapture(
    new OpenAI({
      apiKey: keys.openrouterApiKey,
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
export function hasOpenRouter(): boolean {
  return !!loadKeys().openrouterApiKey;
}

export function getKeysStatus(): {
  tavilyConfigured: boolean;
  openrouterConfigured: boolean;
  elevenlabsConfigured: boolean;
  fallbackModel: string;
  embeddingModel: string;
} {
  const keys = loadKeys();
  return {
    tavilyConfigured: !!keys.tavilyApiKey,
    openrouterConfigured: !!keys.openrouterApiKey,
    elevenlabsConfigured: !!keys.elevenlabsApiKey,
    fallbackModel: getFallbackModel(),
    embeddingModel: keys.embeddingModel || 'openai/text-embedding-3-large',
  };
}
