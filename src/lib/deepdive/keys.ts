import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import OpenAI from 'openai';

const KEYS_PATH = join(process.cwd(), 'keys.json');

export interface DeepDiveKeys {
  zaiApiKey?: string;
  zaiBaseUrl?: string;
  zaiModel?: string;
  tavilyApiKey?: string;
  openrouterApiKey?: string;
  embeddingModel?: string;
}

export function loadKeys(): DeepDiveKeys {
  if (!existsSync(KEYS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(KEYS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveKeys(keys: DeepDiveKeys): void {
  writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2), 'utf-8');
}

export function getOpenAIClient(): OpenAI {
  const keys = loadKeys();
  if (!keys.zaiApiKey) throw new Error('Z.AI API key not configured');
  return new OpenAI({
    apiKey: keys.zaiApiKey,
    baseURL: keys.zaiBaseUrl || 'https://api.z.ai/api/paas/v4/',
  });
}

export function getModel(): string {
  const keys = loadKeys();
  return keys.zaiModel || 'glm-4-plus';
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

export function getEmbeddingModel(): string {
  const keys = loadKeys();
  return keys.embeddingModel || 'openai/text-embedding-3-small';
}

export function getKeysStatus(): {
  zaiConfigured: boolean;
  tavilyConfigured: boolean;
  openrouterConfigured: boolean;
  zaiBaseUrl: string;
  zaiModel: string;
  embeddingModel: string;
} {
  const keys = loadKeys();
  return {
    zaiConfigured: !!keys.zaiApiKey,
    tavilyConfigured: !!keys.tavilyApiKey,
    openrouterConfigured: !!keys.openrouterApiKey,
    zaiBaseUrl: keys.zaiBaseUrl || 'https://api.z.ai/api/paas/v4/',
    zaiModel: keys.zaiModel || 'glm-4-plus',
    embeddingModel: keys.embeddingModel || 'openai/text-embedding-3-small',
  };
}
