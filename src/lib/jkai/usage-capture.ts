import type OpenAI from 'openai';
import { recordLLMCall, type LLMCallRecord, executionContext } from '$lib/workflows/execution-context';
import { priceFor, computeCost } from '$lib/jkai/llm-pricing';
import { recordDurableLLMCall } from '$lib/jkai/llm-usage-log';
import { isReasoningModel, REASONING_TOKEN_FLOOR } from '$lib/constants/default-models';

export interface CompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

/** Extract telemetry from a completion response and push it into (a) the active
 *  execution context (for per-node workflow rollup — no-op outside a node) and
 *  (b) the durable agent_actions cost ledger (so /admin/ops/costs reflects the
 *  call regardless of where it originated). Robust to missing fields: if usage
 *  is absent, tokens/cost record as null — never a fabricated zero. */
function captureUsage(
  provider: 'openrouter',
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
  // Per-node workflow rollup (no-op outside an engine-managed node).
  recordLLMCall(record);

  // Durable ledger row — only when we actually have usage data, so we don't
  // clutter the cost table with null-cost "call happened" rows.
  if (promptTokens !== null || completionTokens !== null) {
    const store = executionContext.getStore();
    recordDurableLLMCall({
      provider,
      model,
      tokensInput: promptTokens,
      tokensOutput: completionTokens,
      costUsd,
      source: store ? 'workflow' : 'gateway',
      sessionId: store?.runId ?? null,
    });
  }
}

/** Wrap a streamed completion so end-of-stream usage is captured, WITHOUT
 *  altering any yielded chunk. A Proxy delegates every property/method to the
 *  real SDK Stream (so .controller/.tee/etc. keep working) and only interposes
 *  on iteration to observe the final usage-bearing chunk. */
function wrapStreamForUsage(
  stream: AsyncIterable<{ usage?: CompletionUsage }>,
  provider: 'openrouter',
  model: string,
): AsyncIterable<{ usage?: CompletionUsage }> {
  let lastUsage: CompletionUsage | undefined;
  let recorded = false;
  const flush = () => {
    if (recorded) return;
    recorded = true;
    captureUsage(provider, model, lastUsage);
  };

  return new Proxy(stream, {
    get(target, prop, recv) {
      if (prop === Symbol.asyncIterator) {
        return function () {
          const inner = (target as AsyncIterable<{ usage?: CompletionUsage }>)[Symbol.asyncIterator]();
          return {
            next: async () => {
              try {
                const r = await inner.next();
                if (r.value?.usage) lastUsage = r.value.usage;
                if (r.done) flush();
                return r;
              } catch (err) {
                flush();
                throw err;
              }
            },
            return: async (v?: unknown) => {
              flush();
              return inner.return ? inner.return(v) : { done: true as const, value: v };
            },
            throw: inner.throw ? (e?: unknown) => inner.throw!(e) : undefined,
          };
        };
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as AsyncIterable<{ usage?: CompletionUsage }>;
}

/** Reasoning models spend max_tokens on thinking before emitting a single
 *  visible character, so a caller that asked for 50 (classifiers, routers,
 *  short summaries) gets an empty string. Lift the cap to the floor — this only
 *  raises a ceiling, so a model that wants to answer in 10 tokens still does.
 *  Callers that deliberately budget MORE than the floor keep their value. */
function withReasoningHeadroom<T extends { model?: string; max_tokens?: number | null }>(params: T): T {
  const model = params.model ?? '';
  if (!model || !isReasoningModel(model)) return params;
  const requested = params.max_tokens;
  if (typeof requested !== 'number' || requested >= REASONING_TOKEN_FLOOR) return params;
  return { ...params, max_tokens: REASONING_TOKEN_FLOOR };
}

/** Wrap a client's `chat.completions.create` so every call — streaming and
 *  non-streaming — captures usage into the workflow rollup AND the durable cost
 *  ledger, and every reasoning-model call gets enough headroom to actually
 *  answer. For streams we ensure the provider emits a final usage chunk
 *  (stream_options.include_usage) and observe it transparently as the stream is
 *  consumed. Embeddings are not intercepted (only chat.completions). */
export function installUsageCapture(client: OpenAI, provider: 'openrouter'): OpenAI {
  type CreateFn = typeof client.chat.completions.create;
  const completions = client.chat.completions as unknown as { create: CreateFn };
  const original = completions.create.bind(completions);

  // The OpenAI SDK's create() has overloaded signatures (streaming vs not);
  // an `as any` cast is the only sane way to monkey-patch without recreating
  // the overload set by hand.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  completions.create = (async function (this: unknown, ...args: unknown[]): Promise<unknown> {
    const params = withReasoningHeadroom(
      (args[0] ?? {}) as {
        model?: string;
        max_tokens?: number | null;
        stream?: boolean;
        stream_options?: Record<string, unknown> | null;
      },
    );
    args[0] = params;
    const model = params.model ?? '';

    if (params.stream) {
      // Ask the provider for a trailing usage-only chunk if the caller didn't.
      // The final chunk has empty choices, which every consumer already skips.
      if (model && !params.stream_options?.include_usage) {
        args[0] = { ...params, stream_options: { ...(params.stream_options ?? {}), include_usage: true } };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await (original as any)(...args);
      if (!model) return stream;
      return wrapStreamForUsage(stream as AsyncIterable<{ usage?: CompletionUsage }>, provider, model);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (original as any)(...args);
    if (model) {
      const usage = (result as { usage?: CompletionUsage })?.usage;
      captureUsage(provider, model, usage);
    }
    return result;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  return client;
}
