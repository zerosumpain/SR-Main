import type OpenAI from 'openai';
import { recordLLMCall, type LLMCallRecord } from '$lib/workflows/execution-context';
import { priceFor, computeCost } from '$lib/jkai/llm-pricing';

export interface CompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

/** Extract telemetry from a non-streaming completion response and push it
 *  into the active execution context (no-op if called outside an engine-
 *  managed node, e.g. from the /jkai chat hub). Robust to missing fields:
 *  if usage is absent, the call records nulls everywhere — never zeros. */
function captureUsage(
  provider: 'zai' | 'openrouter',
  model: string,
  usage: CompletionUsage | null | undefined,
): void {
  const promptTokens = usage?.prompt_tokens ?? null;
  const completionTokens = usage?.completion_tokens ?? null;
  const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens ?? null;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? null;

  const pricing = priceFor(provider, model);
  const costUsd =
    pricing && promptTokens !== null && completionTokens !== null
      ? computeCost(pricing, promptTokens, completionTokens)
      : null;

  const record: LLMCallRecord = {
    provider,
    model,
    tokensInput: promptTokens,
    tokensOutput: completionTokens,
    cacheReadTokens,
    reasoningTokens,
    costUsd,
    priceSnapshot: pricing
      ? { inputPerMillion: pricing.inputPerMillion, outputPerMillion: pricing.outputPerMillion }
      : null,
  };
  recordLLMCall(record);
}

/** Wrap a client's `chat.completions.create` so every non-streaming call
 *  captures usage into the active execution context. Streaming calls pass
 *  through unmodified — provider streams don't always surface usage, and
 *  capturing it would require iterator interposition. Workflow nodes are
 *  predominantly non-streaming, so the streaming gap costs little. */
export function installUsageCapture(client: OpenAI, provider: 'zai' | 'openrouter'): OpenAI {
  type CreateFn = typeof client.chat.completions.create;
  const completions = client.chat.completions as unknown as { create: CreateFn };
  const original = completions.create.bind(completions);

  // The OpenAI SDK's create() has overloaded signatures (streaming vs not);
  // an `as any` cast is the only sane way to monkey-patch without recreating
  // the overload set by hand.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  completions.create = (async function (this: unknown, ...args: unknown[]): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params = (args[0] ?? {}) as { model?: string; stream?: boolean };
    const model = params.model ?? '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (original as any)(...args);

    if (!params.stream && model) {
      const usage = (result as { usage?: CompletionUsage })?.usage;
      captureUsage(provider, model, usage);
    }
    return result;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  return client;
}
