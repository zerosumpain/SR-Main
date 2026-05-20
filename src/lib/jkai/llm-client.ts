import OpenAI from 'openai';
import { loadKeys } from '$lib/deepdive/keys';
import { getOpenRouterApiKey } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { installUsageCapture } from '$lib/jkai/usage-capture';

const ZAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4/';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const cache: { zai?: OpenAI; openrouter?: OpenAI } = {};

export function clearLLMClientCache(): void {
  cache.zai = undefined;
  cache.openrouter = undefined;
}

export async function getLLMClient(ctx: ModelContext): Promise<{ client: OpenAI; model: string }> {
  if (ctx.provider === 'zai') {
    if (!cache.zai) {
      const keys = loadKeys();
      if (!keys.zaiApiKey) throw new Error('Z.AI API key not configured');
      cache.zai = installUsageCapture(
        new OpenAI({
          apiKey: keys.zaiApiKey,
          baseURL: keys.zaiBaseUrl || ZAI_BASE_URL,
        }),
        'zai',
      );
    }
    return { client: cache.zai, model: ctx.modelId };
  }

  if (ctx.provider === 'openrouter') {
    if (!cache.openrouter) {
      const apiKey = await getOpenRouterApiKey();
      if (!apiKey) throw new Error('OpenRouter API key not configured');
      cache.openrouter = installUsageCapture(
        new OpenAI({
          apiKey,
          baseURL: OPENROUTER_BASE_URL,
        }),
        'openrouter',
      );
    }
    return { client: cache.openrouter, model: ctx.modelId };
  }

  throw new Error(`Unknown provider: ${ctx.provider}`);
}
