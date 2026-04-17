import OpenAI from 'openai';
import { loadKeys } from '$lib/deepdive/keys';

const DEFAULT_BASE_URL = 'https://api.z.ai/api/coding/paas/v4/';
const DEFAULT_MODEL = 'glm-5.1';

let cached: { client: OpenAI; model: string } | null = null;

export function getLLMClient(): { client: OpenAI; model: string } {
  if (cached) return cached;

  const keys = loadKeys();
  if (!keys.zaiApiKey) throw new Error('Z.AI API key not configured');

  const client = new OpenAI({
    apiKey: keys.zaiApiKey,
    baseURL: keys.zaiBaseUrl || DEFAULT_BASE_URL,
  });
  const model = keys.zaiModel || DEFAULT_MODEL;

  cached = { client, model };
  return cached;
}

export function clearLLMClientCache(): void {
  cached = null;
}
