// src/lib/llm/workflow-gateway.ts
//
// Resilient LLM calls for WORKFLOW nodes. Wraps the raw
// `client.chat.completions.create()` that workflow node executors used directly
// with the same resilience the deep-research gateway has:
//   - concurrency throttle (a counting-semaphore caps parallel LLM calls so a
//     wide DAG can't fire dozens of requests at once),
//   - per-call timeout (reasoning models can hang; without this a node
//     waits forever),
//   - primary-model → fallback-model failover on rate-limit / our-timeout (a
//     slow/limited primary degrades to a fast, cheap fallback model instead of
//     failing the run).
//
// The provider-agnostic mechanics live in $lib/llm/resilience. Provider/key
// resolution reuses the workflow's own resolveLLMClient + the unified
// getLLMClient (admin-settings-aware OpenRouter key).

import type OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { resolveLLMClient } from '$lib/workflows/nodes/llm-helpers';
import { getLLMClient } from '$lib/llm/client';
import { getFallbackModel } from '$lib/llm/keys';
import {
  pLimit,
  withRetry,
  combineSignals,
  isRateLimitError,
  isOurTimeoutAbort,
} from '$lib/llm/resilience';

/** Per-call ceiling for a non-streaming workflow LLM call. Generous, because
 *  reasoning models can take tens of seconds; a stuck call falls back. */
const NONSTREAM_TIMEOUT_MS = 90_000;
/** Idle gap allowed between streamed tokens before the watchdog aborts. */
const STREAM_IDLE_TIMEOUT_MS = 45_000;

/** Max concurrent workflow LLM calls (a wide DAG of llm nodes is the risk). */
function getWorkflowConcurrency(): number {
  const raw = process.env.WORKFLOW_LLM_CONCURRENCY;
  if (!raw) return 6;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 6;
}

// Module-level limiter shared across all workflow LLM calls in this process.
const limit = pLimit(getWorkflowConcurrency());

export interface ChatBody {
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  max_tokens?: number;
  response_format?: unknown;
  /** Tool/function-calling schemas — passed straight through to the provider.
   *  Present so the orchestrator's generation loop can route through this
   *  gateway without a separate raw-client code path. */
  tools?: unknown;
  tool_choice?: unknown;
}

/** Some fallback models (e.g. Anthropic via OpenRouter) reject
 *  response_format; strip it for the fallback path. Tools/tool_choice are
 *  preserved — the fallback model still needs them. */
function stripResponseFormat(body: ChatBody): ChatBody {
  const { response_format: _omitRf, ...rest } = body;
  return rest;
}

/**
 * Non-streaming resilient chat completion for workflow nodes. Returns the raw
 * OpenAI ChatCompletion (callers read choices[0].message.content + usage).
 */
export async function resilientChatCompletion(
  configuredModel: string | undefined,
  body: ChatBody,
  opts?: {
    signal?: AbortSignal;
    /** OpenRouter model to fail over to instead of the global getFallbackModel()
     *  — for callers pinned to a specific model (e.g. the decks art director
     *  stays glm-5.2 across providers). Verify the id exists on OpenRouter:
     *  a dead id makes failover die silently (see reference_zai_balance_outage). */
    fallbackModel?: string;
  },
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const { client, model } = await resolveLLMClient(configuredModel);

  const call = (c: OpenAI, m: string, b: ChatBody) =>
    withRetry(
      () =>
        c.chat.completions.create(
          { ...b, model: m, stream: false } as any,
          { signal: combineSignals(opts?.signal, NONSTREAM_TIMEOUT_MS) as any },
        ),
      `workflow-llm(${m})`,
    ) as Promise<OpenAI.Chat.Completions.ChatCompletion>;

  try {
    return await limit(() => call(client, model, body));
  } catch (err) {
    // Fail over to a DIFFERENT model — when the primary already IS the
    // fallback id, retrying it would just hit the same limit.
    const fallbackModel = opts?.fallbackModel ?? getFallbackModel();
    if (fallbackModel !== model && (isRateLimitError(err) || isOurTimeoutAbort(err, opts?.signal))) {
      try {
        const fb = await getLLMClient({ provider: 'openrouter', modelId: fallbackModel });
        console.warn(
          `[workflow-llm] ${model} ${isRateLimitError(err) ? 'rate-limited' : 'timed out'}; falling back to ${fb.model}`,
        );
        return await limit(() => call(fb.client, fb.model, stripResponseFormat(body)));
      } catch {
        throw err; // fallback unavailable or also failed → surface original
      }
    }
    throw err;
  }
}

export interface StreamResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  /** The model actually used (resolved id, or the fallback model after fallover). */
  model: string;
}

/** One streamed completion with an idle watchdog (aborts if no token arrives
 *  within idleMs). onToken is invoked per content delta. */
async function runStream(
  client: OpenAI,
  model: string,
  body: ChatBody,
  opts: { signal?: AbortSignal; onToken: (delta: string) => void; idleMs: number },
): Promise<StreamResult> {
  const idleAc = new AbortController();
  const ext = opts.signal;
  const onExt = () => idleAc.abort(ext!.reason);
  if (ext) {
    if (ext.aborted) idleAc.abort(ext.reason);
    else ext.addEventListener('abort', onExt, { once: true });
  }
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const reset = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idleAc.abort(new Error('Stream idle timeout')), opts.idleMs);
  };
  reset();

  let content = '';
  let promptTokens = 0;
  let completionTokens = 0;
  try {
    const stream = (await client.chat.completions.create(
      { ...body, model, stream: true, stream_options: { include_usage: true } } as any,
      { signal: idleAc.signal as any },
    )) as unknown as AsyncIterable<any>;
    for await (const chunk of stream) {
      reset();
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        content += delta;
        opts.onToken(delta);
      }
      const u = chunk.usage;
      if (u) {
        promptTokens = u.prompt_tokens ?? promptTokens;
        completionTokens = u.completion_tokens ?? completionTokens;
      }
    }
    return { content, promptTokens, completionTokens, model };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    if (ext) ext.removeEventListener('abort', onExt);
  }
}

/**
 * Streaming resilient chat completion for workflow nodes (e.g. the canvas chat
 * path). Falls back to OpenRouter ONLY before the first token has been emitted
 * (re-streaming after partial output would duplicate tokens).
 */
export async function resilientChatStream(
  configuredModel: string | undefined,
  body: ChatBody,
  opts: { signal?: AbortSignal; onToken: (delta: string) => void },
): Promise<StreamResult> {
  const { client, model } = await resolveLLMClient(configuredModel);

  let emittedAny = false;
  const onToken = (d: string) => {
    emittedAny = true;
    opts.onToken(d);
  };

  try {
    return await limit(() => runStream(client, model, body, { signal: opts.signal, onToken, idleMs: STREAM_IDLE_TIMEOUT_MS }));
  } catch (err) {
    const fallbackModel = getFallbackModel();
    if (!emittedAny && fallbackModel !== model && (isRateLimitError(err) || isOurTimeoutAbort(err, opts.signal))) {
      try {
        const fb = await getLLMClient({ provider: 'openrouter', modelId: fallbackModel });
        console.warn(
          `[workflow-llm] ${model} stream ${isRateLimitError(err) ? 'rate-limited' : 'timed out'}; falling back to ${fb.model}`,
        );
        return await limit(() =>
          runStream(fb.client, fb.model, stripResponseFormat(body), { signal: opts.signal, onToken, idleMs: STREAM_IDLE_TIMEOUT_MS }),
        );
      } catch {
        throw err;
      }
    }
    throw err;
  }
}
