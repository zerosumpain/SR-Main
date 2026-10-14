// src/lib/trips/llm.server.ts
//
// The trip planner's model calls, all through `$lib/llm/client` and the
// workload registry (`trips-planner` for the conversation, `trips-reader` for
// the cheap readers and guidance). JSON out, parsed leniently; a call that
// cannot be made throws, and every caller has a no-model path.

import type OpenAI from 'openai';
import { getLLMClient } from '$lib/llm/client';
import { withActivity } from '$lib/context/activity';
import { thinkingRequestParams } from '$lib/models/thinking';
import { getWorkload } from '$lib/models/workloads';
import { resolveWorkloadModel } from '$lib/server/models/workload-settings';
import { parseLooseJson } from './research';

export type TripWorkload = 'trips-planner' | 'trips-reader';

export interface JsonCallOptions {
  maxTokens: number;
  timeoutMs?: number;
  temperature?: number;
}

export async function jsonCall(
  workload: TripWorkload,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: JsonCallOptions,
): Promise<unknown> {
  const def = getWorkload(workload);
  if (!def) throw new Error(`${workload} workload is not registered`);
  const ctx = await resolveWorkloadModel(def);
  const { client, model } = await getLLMClient(ctx);
  const call = () =>
    client.chat.completions.create(
      {
        model,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens,
        response_format: { type: 'json_object' },
        messages,
        ...thinkingRequestParams(ctx.provider, workload === 'trips-planner' ? 'low' : 'off', ctx.modelId),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      { signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000), maxRetries: 1 },
    );
  // Literal tags, so the cost ledger's registry check can see them.
  const once = () => (workload === 'trips-planner' ? withActivity('trips-planner', call) : withActivity('trips-reader', call));
  // An answer that is not JSON (empty, cut off) is asked for once more before
  // the caller's no-model path takes over.
  for (let attempt = 1; ; attempt++) {
    const res = await once();
    const choice = res.choices[0];
    const content = choice?.message?.content ?? '';
    const parsed = parseLooseJson(content);
    if (parsed && typeof parsed === 'object') return parsed;
    console.warn(`[trips/llm] ${workload}: unusable answer (attempt ${attempt}, finish=${choice?.finish_reason}, chars=${content.length})`);
    if (attempt >= 2) throw new Error(`${workload} returned no JSON`);
  }
}
