import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import type { PriceSnapshot, Usage, UsageDelta } from './types';

export function computeCost(usage: Usage, snapshot: PriceSnapshot | null): number {
  if (!snapshot) return 0;
  const prompt = usage.promptTokens * snapshot.promptPrice;
  const completion = usage.completionTokens * snapshot.completionPrice;
  return prompt + completion;
}

export async function recordConversationUsage(
  conversationId: string,
  usage: Usage,
  snapshot: PriceSnapshot | null,
): Promise<UsageDelta> {
  const cost = computeCost(usage, snapshot);
  await db.execute(sql`
    UPDATE jkai_conversations
    SET prompt_tokens = prompt_tokens + ${usage.promptTokens},
        completion_tokens = completion_tokens + ${usage.completionTokens},
        cost_usd = cost_usd + ${cost}
    WHERE id = ${conversationId}
  `);
  return { ...usage, costUsd: cost };
}

export async function recordBuildUsage(
  buildId: string,
  usage: Usage,
  snapshot: PriceSnapshot | null,
): Promise<UsageDelta> {
  const cost = computeCost(usage, snapshot);
  await db.execute(sql`
    UPDATE jkai_builds
    SET tokens_used = tokens_used + ${usage.promptTokens + usage.completionTokens},
        cost_usd = cost_usd + ${cost}
    WHERE id = ${buildId}
  `);
  return { ...usage, costUsd: cost };
}

/** Parse OpenAI-SDK usage block into our Usage shape. */
export function parseUsage(
  raw: { prompt_tokens?: number; completion_tokens?: number } | undefined,
): Usage {
  return {
    promptTokens: raw?.prompt_tokens ?? 0,
    completionTokens: raw?.completion_tokens ?? 0,
  };
}
