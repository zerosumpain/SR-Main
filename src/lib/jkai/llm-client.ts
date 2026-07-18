import OpenAI from 'openai';
import { getOpenRouterApiKey } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { installUsageCapture } from '$lib/jkai/usage-capture';
import { mapLegacyModelId } from '$lib/constants/default-models';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

let openrouterClient: OpenAI | undefined;

export function clearLLMClientCache(): void {
  openrouterClient = undefined;
}

export async function getLLMClient(ctx: ModelContext): Promise<{ client: OpenAI; model: string }> {
  if (!openrouterClient) {
    const apiKey = await getOpenRouterApiKey();
    if (!apiKey) throw new Error('OpenRouter API key not configured');
    openrouterClient = installUsageCapture(
      new OpenAI({
        apiKey,
        baseURL: OPENROUTER_BASE_URL,
      }),
      'openrouter',
    );
  }
  // Legacy contexts (provider 'zai' + bare GLM id) can still arrive from old DB
  // rows or persisted client state — map the model id instead of throwing.
  return { client: openrouterClient, model: mapLegacyModelId(ctx.modelId) };
}
