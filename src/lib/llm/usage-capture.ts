import type OpenAI from 'openai';
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { recordLLMCall, type LLMCallRecord, executionContext } from '$lib/context/execution';
import { priceFor, computeCost } from '$lib/llm/pricing';
import { recordDurableLLMCall } from '$lib/llm/usage-log';
import { currentActivityId } from '$lib/context/activity';
import { currentChatContext, noteChatRound } from '$lib/context/chat';
import { currentResearchSessionId } from '$lib/context/research-meter';
import { isReasoningModel, REASONING_TOKEN_FLOOR } from '$lib/constants/default-models';
import type { ModelProvider } from '$lib/server/models/types';

export interface CompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
  /**
   * What the provider says it charged, in USD. OpenRouter sends this on every
   * response; nothing else does.
   *
   * It is authoritative where our own arithmetic is a guess. A grounded
   * completion measured $0.149, of which $0.126 was a search fee and only
   * $0.023 was tokens — so pricing it from a per-token table reported it at a
   * sixth of the real bill. Anything charged per REQUEST rather than per token
   * is invisible to `computeCost` by construction.
   */
  cost?: number;
}

/** Extract telemetry from a completion response and push it into (a) the active
 *  execution context (for per-node workflow rollup — no-op outside a node) and
 *  (b) the durable agent_actions cost ledger (so /admin/ops/costs reflects the
 *  call regardless of where it originated). Robust to missing fields: if usage
 *  is absent, tokens/cost record as null — never a fabricated zero. */
/** When the call started and, for a stream, when its first content token
 *  arrived. Both epoch ms. Absent for callers that cannot measure. */
export interface CallTiming {
  startedAt: number;
  firstTokenAt?: number | null;
}

function captureUsage(
  provider: ModelProvider,
  model: string,
  usage: CompletionUsage | null | undefined,
  timing?: CallTiming,
): void {
  const promptTokens = usage?.prompt_tokens ?? null;
  const completionTokens = usage?.completion_tokens ?? null;
  const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens ?? null;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? null;

  const pricing = priceFor(provider, model);
  /**
   * The provider's own figure wins over our arithmetic.
   *
   * `computeCost` multiplies a per-token price table, which cannot see anything
   * billed per request — a web-search fee, a tool surcharge. When OpenRouter
   * reports `usage.cost` it has already counted all of it, so preferring the
   * table would be choosing a number we know to be low. Codex reports nothing
   * and prices as null, which stays null rather than becoming a false zero.
   */
  const reportedCost = typeof usage?.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : null;
  const costUsd =
    reportedCost ??
    (pricing && promptTokens !== null && completionTokens !== null
      ? computeCost(pricing, promptTokens, completionTokens)
      : null);

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
    // A research run is not a workflow node, so it has no execution context and
    // every call it made used to record with a null session id: the spend was
    // in the ledger and unattributable — you could see the site spent $4 last
    // night, not which investigation spent it. Deep research carries its own
    // ambient id for exactly this.
    const researchId = currentResearchSessionId();
    // A chat turn is neither a workflow run nor a research session, so before
    // this it recorded with a null session id and could not be counted at all.
    // See $lib/context/chat for why the job id is the right key.
    const chat = currentChatContext();
    const endedAt = Date.now();
    // A turn is many rounds; the ledger line under the reply has to sum them.
    noteChatRound({
      provider,
      model,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      cacheReadTokens,
      reasoningTokens,
      reportedCostUsd: reportedCost,
    });
    recordDurableLLMCall({
      provider,
      model,
      tokensInput: promptTokens,
      tokensOutput: completionTokens,
      cacheReadTokens,
      reasoningTokens,
      costUsd,
      source: store ? 'workflow' : researchId ? 'research' : chat ? 'jkai-chat' : 'gateway',
      // The workload this call is serving, when it is serving one. Without it
      // every non-workflow, non-research call is indistinguishable in the
      // ledger — see $lib/context/activity.
      activity: currentActivityId(),
      sessionId: store?.runId ?? researchId ?? chat?.jobId ?? chat?.conversationId ?? null,
      conversationId: chat?.conversationId ?? null,
      durationMs: timing ? Math.max(0, endedAt - timing.startedAt) : null,
      ttftMs:
        timing && typeof timing.firstTokenAt === 'number'
          ? Math.max(0, timing.firstTokenAt - timing.startedAt)
          : null,
    });
  }
}

/** Wrap a streamed completion so end-of-stream usage is captured, WITHOUT
 *  altering any yielded chunk. A Proxy delegates every property/method to the
 *  real SDK Stream (so .controller/.tee/etc. keep working) and only interposes
 *  on iteration to observe the final usage-bearing chunk. */
function wrapStreamForUsage(
  stream: AsyncIterable<{ usage?: CompletionUsage }>,
  provider: ModelProvider,
  model: string,
  startedAt: number,
): AsyncIterable<{ usage?: CompletionUsage }> {
  let lastUsage: CompletionUsage | undefined;
  let recorded = false;
  // First chunk carrying actual content — not the first chunk full stop. A
  // stream opens with role/annotation frames that arrive before the model has
  // written anything, and counting those would report a TTFT the reader never
  // experienced.
  let firstTokenAt: number | null = null;
  const noteChunk = (chunk: unknown) => {
    if (firstTokenAt !== null) return;
    const delta = (chunk as { choices?: Array<{ delta?: { content?: unknown; reasoning?: unknown } }> })
      ?.choices?.[0]?.delta;
    const hasText =
      (typeof delta?.content === 'string' && delta.content.length > 0) ||
      (typeof delta?.reasoning === 'string' && delta.reasoning.length > 0);
    if (hasText) firstTokenAt = Date.now();
  };
  const flush = () => {
    if (recorded) return;
    recorded = true;
    captureUsage(provider, model, lastUsage, { startedAt, firstTokenAt });
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
                if (!r.done) noteChunk(r.value);
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

/** Per-model completion ceilings from the OpenRouter catalogue, keyed by model
 *  id. Loaded once per process and refreshed on a TTL (same shape as the
 *  settings cache in server/models/settings.ts) — the catalogue only moves when
 *  the nightly model sync runs. */
const CAP_TTL_MS = 5 * 60_000;
let capCache: { caps: Map<string, number>; expiresAt: number } | null = null;

async function getProviderCaps(): Promise<Map<string, number>> {
  if (capCache && capCache.expiresAt > Date.now()) return capCache.caps;

  const caps = new Map<string, number>();
  try {
    const rows = await db
      .select({
        id: openrouterModels.id,
        cap: sql<string | null>`${openrouterModels.raw} -> 'top_provider' ->> 'max_completion_tokens'`,
      })
      .from(openrouterModels);
    for (const r of rows) {
      const n = r.cap === null ? NaN : Number(r.cap);
      if (Number.isFinite(n) && n >= 1) caps.set(r.id, Math.floor(n));
    }
  } catch (err) {
    // No catalogue (fresh DB, migration, unit test) → no clamp. Cache the empty
    // map for the TTL so a broken read doesn't run a query per LLM call.
    console.warn('[usage-capture] could not read OpenRouter completion caps:', (err as Error).message);
  }
  capCache = { caps, expiresAt: Date.now() + CAP_TTL_MS };
  return caps;
}

/** Counterpart to the reasoning floor above: 76 of the ~340 catalogued models
 *  advertise a completion ceiling below the 25000 canvas LLM nodes now default
 *  to (the lowest of those ceilings is 16384), and a request over a provider's
 *  cap is rejected rather than trimmed. Clamp DOWN only, so a caller that asked
 *  for less than the ceiling keeps its value. Belt-and-braces: no provider 400
 *  of this kind has been observed here — the catalogue figure is what justifies
 *  the guard, not a captured failure. */
async function withProviderCap<T extends { model?: string; max_tokens?: number | null }>(
  params: T,
): Promise<T> {
  const model = params.model ?? '';
  const requested = params.max_tokens;
  if (!model || typeof requested !== 'number') return params;
  const cap = (await getProviderCaps()).get(model);
  if (cap === undefined || requested <= cap) return params;
  console.warn(
    `[usage-capture] ${model} caps completions at ${cap}; clamping the requested max_tokens ${requested}.`,
  );
  return { ...params, max_tokens: cap };
}

/**
 * Wrap `embeddings.create` so embedding spend reaches the ledger too.
 *
 * This was the largest silent hole in the cost picture. Embeddings are not
 * cheap in aggregate — RAG ingest, Drive file embeddings and the knowledge index
 * embed every chunk of every document, in batches of 48 — and none of it was
 * recorded, because the wrapper below only ever touched `chat.completions`.
 *
 * Two things differ from a chat call and both are handled honestly rather than
 * papered over:
 *  - there are no completion tokens, so `tokensOutput` records 0, not null: the
 *    call really did produce no output tokens, which is not the same as "we
 *    don't know";
 *  - OpenRouter's /models feed carries no embedding models at all, so
 *    `priceFor` returns null for every one of them. The provider's own
 *    `usage.cost` is therefore usually the ONLY price signal, and where it is
 *    absent the row lands with a null cost — visible on the page as an unpriced
 *    call rather than as a fabricated zero.
 */
function installEmbeddingCapture(client: OpenAI, provider: ModelProvider): void {
  type CreateFn = typeof client.embeddings.create;
  const embeddings = client.embeddings as unknown as { create?: CreateFn } | undefined;
  // A real SDK client always has this; a test double or a narrower shim may not.
  // Usage capture must never be the reason a client stops working — that is the
  // same rule the ledger insert follows, one layer down.
  if (typeof embeddings?.create !== 'function') return;
  const original = embeddings.create.bind(embeddings);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  embeddings.create = (async function (this: unknown, ...args: unknown[]): Promise<unknown> {
    const params = (args[0] ?? {}) as { model?: string };
    // Embeddings are never streamed, so start-to-return IS the whole call.
    const startedAt = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (original as any)(...args);
    const model = params.model ?? '';
    if (!model) return result;

    const usage = (result as { usage?: { prompt_tokens?: number; total_tokens?: number; cost?: number } })
      ?.usage;
    const promptTokens = usage?.prompt_tokens ?? usage?.total_tokens ?? null;
    if (promptTokens === null) return result;

    const pricing = priceFor(provider, model);
    const reportedCost =
      typeof usage?.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : null;
    const costUsd = reportedCost ?? (pricing ? computeCost(pricing, promptTokens, 0) : null);

    recordLLMCall({
      provider,
      model,
      tokensInput: promptTokens,
      tokensOutput: 0,
      cacheReadTokens: null,
      reasoningTokens: null,
      costUsd,
      priceSnapshot: pricing
        ? { inputPerMillion: pricing.inputPerMillion, outputPerMillion: pricing.outputPerMillion }
        : null,
    });

    const store = executionContext.getStore();
    const researchId = currentResearchSessionId();
    // A chat turn is neither a workflow run nor a research session, so before
    // this it recorded with a null session id and could not be counted at all.
    // See $lib/context/chat for why the job id is the right key.
    const chat = currentChatContext();
    const endedAt = Date.now();
    recordDurableLLMCall({
      provider,
      model,
      tokensInput: promptTokens,
      tokensOutput: 0,
      costUsd,
      source: store ? 'workflow' : researchId ? 'research' : chat ? 'jkai-chat' : 'gateway',
      activity: currentActivityId(),
      sessionId: store?.runId ?? researchId ?? chat?.jobId ?? chat?.conversationId ?? null,
      conversationId: chat?.conversationId ?? null,
      durationMs: Math.max(0, endedAt - startedAt),
      ttftMs: null,
    });
    return result;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

/** Wrap a client's `chat.completions.create` so every call — streaming and
 *  non-streaming — captures usage into the workflow rollup AND the durable cost
 *  ledger, every reasoning-model call gets enough headroom to actually answer,
 *  and no call asks for more output than its model's provider will allow.
 *  For streams we ensure the provider emits a final usage chunk
 *  (stream_options.include_usage) and observe it transparently as the stream is
 *  consumed. `embeddings.create` is wrapped too — see installEmbeddingCapture. */
export function installUsageCapture(client: OpenAI, provider: ModelProvider): OpenAI {
  installEmbeddingCapture(client, provider);

  type CreateFn = typeof client.chat.completions.create;
  const completions = client.chat.completions as unknown as { create: CreateFn };
  const original = completions.create.bind(completions);

  // The OpenAI SDK's create() has overloaded signatures (streaming vs not);
  // an `as any` cast is the only sane way to monkey-patch without recreating
  // the overload set by hand.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  completions.create = (async function (this: unknown, ...args: unknown[]): Promise<unknown> {
    // Floor first (reasoning headroom), ceiling second — a model whose provider
    // caps below the reasoning floor must end up at the cap, not the floor.
    const params = await withProviderCap(
      withReasoningHeadroom(
        (args[0] ?? {}) as {
          model?: string;
          max_tokens?: number | null;
          stream?: boolean;
          stream_options?: Record<string, unknown> | null;
        },
      ),
    );
    args[0] = params;
    const model = params.model ?? '';
    // Stamped after param massaging so it measures the provider round trip, not
    // our own preparation. Both branches below use it.
    const startedAt = Date.now();

    if (params.stream) {
      // Ask the provider for a trailing usage-only chunk if the caller didn't.
      // The final chunk has empty choices, which every consumer already skips.
      if (model && !params.stream_options?.include_usage) {
        args[0] = { ...params, stream_options: { ...(params.stream_options ?? {}), include_usage: true } };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await (original as any)(...args);
      if (!model) return stream;
      return wrapStreamForUsage(
        stream as AsyncIterable<{ usage?: CompletionUsage }>,
        provider,
        model,
        startedAt,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (original as any)(...args);
    if (model) {
      const usage = (result as { usage?: CompletionUsage })?.usage;
      // Non-streamed: there is no first token to observe, the whole reply
      // arrives at once, so TTFT is left null rather than equated to duration.
      captureUsage(provider, model, usage, { startedAt });
    }
    return result;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  return client;
}
