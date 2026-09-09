import { env } from '$env/dynamic/private';
import { getLLMClient } from '$lib/llm/client';
import { coerceModelContext } from '$lib/constants/default-models';
import type { ProposalTransport } from './extraction';

export function proposalTransport(firstLook = false): ProposalTransport | null {
  if (!env.POLICY_LAB_MODEL) return null;
  return { async complete(system, data) {
    const { client, model } = await getLLMClient(coerceModelContext({ modelId: env.POLICY_LAB_MODEL! }));
    const response = await client.chat.completions.create({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: data }], response_format: { type: 'json_object' }, max_tokens: firstLook ? 4500 : 16000 }, { timeout: firstLook ? 25000 : 90000, maxRetries: 0 });
    return { content: response.choices[0]?.message?.content ?? '', model: response.model };
  } };
}
