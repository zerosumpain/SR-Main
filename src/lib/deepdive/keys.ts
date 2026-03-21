import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import OpenAI from 'openai';

const KEYS_PATH = join(process.cwd(), 'keys.json');

export interface DeepDiveKeys {
  zaiApiKey?: string;
  zaiBaseUrl?: string;
  zaiModel?: string;
  tavilyApiKey?: string;
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
    baseURL: keys.zaiBaseUrl || 'https://api.z.ai/v1',
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

export function getKeysStatus(): { zaiConfigured: boolean; tavilyConfigured: boolean; zaiBaseUrl: string; zaiModel: string } {
  const keys = loadKeys();
  return {
    zaiConfigured: !!keys.zaiApiKey,
    tavilyConfigured: !!keys.tavilyApiKey,
    zaiBaseUrl: keys.zaiBaseUrl || 'https://api.z.ai/v1',
    zaiModel: keys.zaiModel || 'glm-4-plus',
  };
}
