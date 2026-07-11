import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import OpenAI from 'openai';
import { installUsageCapture } from '$lib/jkai/usage-capture';

const KEYS_PATH = join(process.cwd(), 'keys.json');

export interface DeepDiveKeys {
  zaiApiKey?: string;
  zaiBaseUrl?: string;
  zaiModel?: string;
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
  const env = process.env;
  return {
    zaiApiKey: fileKeys.zaiApiKey ?? env.ZAI_API_KEY,
    zaiBaseUrl: fileKeys.zaiBaseUrl ?? env.ZAI_BASE_URL,
    zaiModel: fileKeys.zaiModel ?? env.ZAI_MODEL,
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

export function getOpenAIClient(): OpenAI {
  const keys = loadKeys();
  if (!keys.zaiApiKey) throw new Error('Z.AI API key not configured');
  return installUsageCapture(
    new OpenAI({
      apiKey: keys.zaiApiKey,
      baseURL: keys.zaiBaseUrl || 'https://api.z.ai/api/coding/paas/v4/',
    }),
    'zai',
  );
}

export function getModel(): string {
  const keys = loadKeys();
  return keys.zaiModel || 'glm-5.1';
}

export function getTavilyKey(): string {
  const keys = loadKeys();
  if (!keys.tavilyApiKey) throw new Error('Tavily API key not configured');
  return keys.tavilyApiKey;
}

export function getOpenRouterClient(): OpenAI {
  const keys = loadKeys();
  if (!keys.openrouterApiKey) throw new Error('OpenRouter API key not configured');
  return new OpenAI({
    apiKey: keys.openrouterApiKey,
    baseURL: 'https://openrouter.ai/api/v1',
  });
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

/** Returns the OpenRouter model to use as a rate-limit fallback for z.ai calls.
 *  Default = the same GLM served via OpenRouter, so fallback output stays
 *  consistent with the primary. (Was anthropic/claude-3-5-haiku, which
 *  OpenRouter REMOVED — every gateway fallback silently failed on the dead
 *  model id until this was caught on 2026-07-11.) */
export function getFallbackModel(): string {
  return loadKeys().openrouterFallbackModel || 'z-ai/glm-5-turbo';
}

/** True when an OpenRouter API key is configured (fallback is available). */
export function hasOpenRouter(): boolean {
  return !!loadKeys().openrouterApiKey;
}

export function getKeysStatus(): {
  zaiConfigured: boolean;
  tavilyConfigured: boolean;
  openrouterConfigured: boolean;
  elevenlabsConfigured: boolean;
  zaiBaseUrl: string;
  zaiModel: string;
  embeddingModel: string;
} {
  const keys = loadKeys();
  return {
    zaiConfigured: !!keys.zaiApiKey,
    tavilyConfigured: !!keys.tavilyApiKey,
    openrouterConfigured: !!keys.openrouterApiKey,
    elevenlabsConfigured: !!keys.elevenlabsApiKey,
    zaiBaseUrl: keys.zaiBaseUrl || 'https://api.z.ai/api/coding/paas/v4/',
    zaiModel: keys.zaiModel || 'glm-5.1',
    embeddingModel: keys.embeddingModel || 'openai/text-embedding-3-large',
  };
}
