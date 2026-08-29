import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { getOpenRouterClient, getEmbeddingModel, getFallbackModel } from '$lib/llm/keys';
import { getLLMClient, getGroundedCodexClient } from '$lib/llm/client';
import { readCitations, type Citation } from './grounding';
import { resolveDefaultModel } from '$lib/server/models/settings';
import {
  isRateLimitError,
  isOurTimeoutAbort,
  isCreditHeadroomError,
  combineSignals,
  withRetry,
} from '$lib/llm/resilience';

/**
 * Ceiling to retry at when the provider rejects a call for lacking credit
 * headroom for the requested `max_tokens`. Low enough to clear a nearly-spent
 * balance (measured: 1,000 cleared where 2,000 did not), high enough to still
 * produce a usable answer.
 */
const CREDIT_FALLBACK_MAX_TOKENS = 1_000;

/**
 * Pages OpenRouter's web plugin fetches per grounded call.
 *
 * Five is what the measured $0.15-a-run figure was taken at. The grounding fee
 * dominates that cost, so raising this raises the bill roughly in proportion
 * for an answer nobody asked to be broader.
 */
const WEB_PLUGIN_MAX_RESULTS = 5;

/**
 * Codex model used by the free grounding route.
 *
 * Pinned here rather than taken from the site default: the site default can be
 * switched to an OpenRouter model at any time, and this route only exists
 * because it is served by the Codex bridge against the subscription.
 */
const DEFAULT_GROUNDED_CODEX_MODEL = 'gpt-5.6-terra';

// Re-export so existing importers of these from $lib/deepdive/ai keep working.
export { isRateLimitError };

/** Primary client + model: the admin-configured site default (OpenRouter). */
async function getPrimary(): Promise<{ client: import('openai').default; model: string }> {
  return getLLMClient(await resolveDefaultModel());
}

// GLM-class reasoning models spend a lot of reasoning time: a medium 2k-token
// completion measures ~25s end-to-end, and a large clustering prompt (up to 200
// facts) routinely exceeds 30s. A 30s ceiling therefore aborted nearly every
// real deepdive call (synthesis clustering + the report executive summary),
// surfacing as APIUserAbortError "every time". These are background / streamed
// operations, so a generous ceiling is acceptable; genuinely-stuck calls fall
// back to the fallback model below (see isOurTimeoutAbort).
const PRIMARY_NONSTREAM_TIMEOUT_MS = 90_000;
// Idle gap between streamed tokens. Reasoning models can take >30s to emit the
// FIRST token, so allow 45s before the watchdog fires.
const PRIMARY_STREAM_IDLE_TIMEOUT_MS = 45_000;

/** Attempt to close truncated JSON by balancing brackets/braces and removing trailing partial tokens */
function repairJson(text: string): string {
  // Strip trailing incomplete string (e.g. `"some trunca`)
  let s = text.replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '');

  // Count unmatched openers
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    if (ch === '}' || ch === ']') stack.pop();
  }

  // Close any unclosed string
  if (inString) s += '"';

  // Close unmatched brackets/braces
  while (stack.length) {
    const opener = stack.pop();
    s += opener === '{' ? '}' : ']';
  }

  return s;
}

/**
 * Internal helper: make a single (non-streaming) chat call on the OpenRouter client.
 * Used by chatCompletion and jsonCompletion fallback paths.
 */
async function openRouterChat(
  messages: ChatCompletionMessageParam[],
  opts: {
    temperature: number;
    maxTokens: number;
    signal: AbortSignal | undefined;
    json?: boolean;
  },
): Promise<string> {
  const client = await getOpenRouterClient();
  const model = getFallbackModel();
  const fallbackSignal = AbortSignal.timeout(60_000);
  const combinedSignal = opts.signal
    ? AbortSignal.any([opts.signal, fallbackSignal])
    : fallbackSignal;

  // Anthropic models on OpenRouter don't support response_format: { type: 'json_object' }.
  // The system prompt already instructs JSON-only output; repairJson handles any slippage.
  const response = await client.chat.completions.create(
    { model, messages, temperature: opts.temperature, max_tokens: opts.maxTokens },
    { signal: combinedSignal as any },
  );
  return response.choices[0]?.message?.content ?? '';
}

export async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
): Promise<string> {
  const { client, model } = await getPrimary();
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];
  const temperature = options?.temperature ?? 0.7;
  const maxTokens = options?.maxTokens ?? 4096;

  try {
    const response = await withRetry(
      () =>
        client.chat.completions.create(
          { model, messages, temperature, max_tokens: maxTokens },
          { signal: combineSignals(options?.signal, PRIMARY_NONSTREAM_TIMEOUT_MS) as any },
        ),
      'chatCompletion',
    );
    return response.choices[0]?.message?.content ?? '';
  } catch (err: any) {
    // Fall back to a DIFFERENT OpenRouter model; retrying the same id would
    // just hit the same limit.
    if ((isRateLimitError(err) || isOurTimeoutAbort(err, options?.signal)) && getFallbackModel() !== model) {
      const why = isRateLimitError(err) ? 'rate-limited' : 'timed out';
      console.log(`[deepdive] chatCompletion: ${model} ${why}, falling back to ${getFallbackModel()}`);
      return openRouterChat(messages, { temperature, maxTokens, signal: options?.signal });
    }
    throw err;
  }
}

/**
 * Strip a ```json … ``` wrapper. Models ignore "no code blocks" often enough
 * that a fenced reply is a routine outcome, not an anomaly — and every fenced
 * reply used to die in JSON.parse before repairJson (which only balances
 * brackets) ever had a chance.
 */
export function stripCodeFences(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return text;
  return t.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
}

function parseJsonText<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const unfenced = stripCodeFences(text);
    try {
      return JSON.parse(unfenced) as T;
    } catch {
      // Attempt to repair truncated JSON (e.g. from max_tokens cutoff)
      try {
        const repaired = repairJson(unfenced);
        return JSON.parse(repaired) as T;
      } catch (err) {
        console.error('[deepdive] jsonCompletion: repair failed. Raw text was:', text.slice(0, 500));
        throw err;
      }
    }
  }
}

export async function jsonCompletion<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal; model?: string },
): Promise<T> {
  // A pinned model is the caller's deliberate choice — the budgeted research
  // tiers pin a fast non-reasoning id precisely because the site default may be
  // slow, and silently falling back to `getPrimary()` would hand them back the
  // latency they pinned to avoid.
  const { client, model } = options?.model
    ? { client: await getOpenRouterClient(), model: options.model }
    : await getPrimary();
  const jsonSystemPrompt = systemPrompt + '\n\nYou MUST respond with valid JSON only. No markdown, no code blocks, no explanation.';
  const messages = [
    { role: 'system' as const, content: jsonSystemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];
  const temperature = options?.temperature ?? 0.3;
  const maxTokens = options?.maxTokens ?? 4096;

  try {
    const response = await withRetry(
      () =>
        client.chat.completions.create(
          {
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
          },
          { signal: combineSignals(options?.signal, PRIMARY_NONSTREAM_TIMEOUT_MS) as any },
        ),
      'jsonCompletion',
    );
    return parseJsonText<T>(response.choices[0]?.message?.content ?? '{}');
  } catch (err: any) {
    if (isCreditHeadroomError(err) && maxTokens > CREDIT_FALLBACK_MAX_TOKENS) {
      console.log(
        `[deepdive] jsonCompletion: ${model} lacks credit headroom for max_tokens=${maxTokens}, retrying at ${CREDIT_FALLBACK_MAX_TOKENS}`,
      );
      const retry = await client.chat.completions.create(
        {
          model,
          messages,
          temperature,
          max_tokens: CREDIT_FALLBACK_MAX_TOKENS,
          response_format: { type: 'json_object' },
        },
        { signal: combineSignals(options?.signal, PRIMARY_NONSTREAM_TIMEOUT_MS) as any },
      );
      return parseJsonText<T>(retry.choices[0]?.message?.content ?? '{}');
    }
    if (
      !options?.model &&
      (isRateLimitError(err) || isOurTimeoutAbort(err, options?.signal)) &&
      getFallbackModel() !== model
    ) {
      const why = isRateLimitError(err) ? 'rate-limited' : 'timed out';
      console.log(`[deepdive] jsonCompletion: ${model} ${why}, falling back to ${getFallbackModel()}`);
      // json: true signals openRouterChat to omit response_format (Anthropic models don't support it)
      const text = await openRouterChat(messages, { temperature, maxTokens, signal: options?.signal, json: true });
      return parseJsonText<T>(text || '{}');
    }
    throw err;
  }
}

async function runStream(
  client: import('openai').default,
  model: string,
  messages: ChatCompletionMessageParam[],
  opts: {
    temperature: number;
    maxTokens: number;
    signal: AbortSignal;
    onToken?: (t: string) => void;
    onReasoning?: (t: string) => void;
  },
): Promise<{ text: string; tokensUsed: number; reasoning: string }> {
  // Watchdog: abort the stream if no token arrives within PRIMARY_STREAM_IDLE_TIMEOUT_MS.
  const idleAc = new AbortController();
  const onExternalAbort = () => idleAc.abort(opts.signal.reason);
  if (opts.signal.aborted) {
    idleAc.abort(opts.signal.reason);
  } else {
    opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleAc.abort(new Error('Stream idle timeout'));
    }, PRIMARY_STREAM_IDLE_TIMEOUT_MS);
  };
  resetIdleTimer();

  try {
    const stream = (await client.chat.completions.create(
      {
        model,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: true,
      },
      { signal: idleAc.signal as any },
    )) as AsyncIterable<import('openai/resources').ChatCompletionChunk>;

    let text = '';
    let reasoning = '';
    let tokensUsed = 0;
    for await (const chunk of stream) {
      resetIdleTimer();
      const choice = chunk.choices[0];
      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        opts.onToken?.(delta);
      }
      // OpenRouter surfaces a model's chain-of-thought as `delta.reasoning`
      // (some providers use `reasoning_content`). This used to be dropped on
      // the floor, which is why the research stream had no reasoning to show
      // even on models that emit plenty of it. Codex emits none by design —
      // its SDK returns one completed message per turn — so callers must not
      // treat an empty reasoning string as a fault.
      const rawDelta = choice?.delta as
        | { reasoning?: string; reasoning_content?: string }
        | undefined;
      const think = rawDelta?.reasoning ?? rawDelta?.reasoning_content;
      if (think) {
        reasoning += think;
        opts.onReasoning?.(think);
      }
      if (chunk.usage?.total_tokens) {
        tokensUsed = chunk.usage.total_tokens;
      }
    }
    return { text, tokensUsed, reasoning };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    opts.signal.removeEventListener('abort', onExternalAbort);
  }
}

export async function streamCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    model?: string;
    onToken?: (token: string) => void;
    /** Reasoning deltas, when the model emits them. Never fires for codex ids. */
    onReasoning?: (token: string) => void;
  },
): Promise<{ text: string; tokensUsed: number; reasoning: string }> {
  // An explicitly-passed model is the caller's deliberate choice — no fallback.
  const explicitModel = !!options?.model;
  const { client, model } = explicitModel
    ? { client: await getOpenRouterClient(), model: options!.model! }
    : await getPrimary();
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];
  const temperature = options?.temperature ?? 0.5;
  const maxTokens = options?.maxTokens ?? 2000;
  // Create a stable external signal (non-null) for runStream
  const externalAc = new AbortController();
  const externalSignal = options?.signal;
  if (externalSignal) {
    if (externalSignal.aborted) externalAc.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', () => externalAc.abort(externalSignal.reason), { once: true });
  }

  // Track whether ANY token reached the caller. The fallback re-streams from
  // scratch, so it is only safe BEFORE the first token — otherwise the client
  // would receive duplicated/garbled output. (For slow-reasoning models the
  // abort almost always fires before the first token; this just makes it safe.)
  let emittedAny = false;
  const onToken = options?.onToken
    ? (t: string) => { emittedAny = true; options.onToken!(t); }
    : undefined;

  try {
    return await runStream(client, model, messages, {
      temperature,
      maxTokens,
      signal: externalAc.signal,
      onToken,
      onReasoning: options?.onReasoning,
    });
  } catch (err: any) {
    // The provider wants a smaller reservation, not a different model. Retrying
    // the SAME model at a lower ceiling is what keeps a thin balance answering
    // instead of failing outright — and it is only safe before the first token,
    // since a re-stream would otherwise duplicate what the caller already saw.
    if (!emittedAny && isCreditHeadroomError(err) && maxTokens > CREDIT_FALLBACK_MAX_TOKENS) {
      console.log(
        `[deepdive] streamCompletion: ${model} lacks credit headroom for max_tokens=${maxTokens}, retrying at ${CREDIT_FALLBACK_MAX_TOKENS}`,
      );
      return runStream(client, model, messages, {
        temperature,
        maxTokens: CREDIT_FALLBACK_MAX_TOKENS,
        signal: externalAc.signal,
        onToken,
        onReasoning: options?.onReasoning,
      });
    }
    // Only fall back on the INITIAL create error (before any tokens); never mid-stream.
    // Skip fallback if the caller explicitly chose a model, or if the fallback
    // id equals the primary (retrying the same model would hit the same limit).
    // An idle-timeout abort (our watchdog, not a caller cancellation) is
    // fallback-eligible just like a rate-limit.
    const fallbackModel = getFallbackModel();
    if (!explicitModel && !emittedAny && fallbackModel !== model && (isRateLimitError(err) || isOurTimeoutAbort(err, externalSignal))) {
      const why = isRateLimitError(err) ? 'rate-limited' : 'timed out';
      console.log(`[deepdive] streamCompletion: ${model} ${why}, falling back to ${fallbackModel}`);
      const fallbackAc = new AbortController();
      if (externalSignal) {
        if (externalSignal.aborted) fallbackAc.abort(externalSignal.reason);
        else externalSignal.addEventListener('abort', () => fallbackAc.abort(externalSignal.reason), { once: true });
      }
      return runStream(await getOpenRouterClient(), fallbackModel, messages, {
        temperature,
        maxTokens,
        signal: fallbackAc.signal,
        onToken,
        onReasoning: options?.onReasoning,
      });
    }
    throw err;
  }
}

/**
 * A completion the model was allowed to look things up for.
 *
 * One function rather than a flag on `streamCompletion`, because the two
 * grounded routes are not variations of the streaming path — they differ in
 * provider, in client, in whether they stream at all, and in nothing else the
 * caller cares about. Keeping the branch here means `runInstant` asks for "an
 * answer, grounded like this" and gets back the same shape either way.
 *
 * Citations come back in the SAME `url_citation` annotation shape from both,
 * which is why the Codex bridge deliberately emits OpenRouter's format. See
 * `$lib/deepdive/grounding` for the measured trade-off between the routes.
 */
export async function groundedCompletion(
  systemPrompt: string,
  userPrompt: string,
  options: {
    mode: 'fast' | 'free';
    /** Only used by `fast`; the free route is whatever Codex model is default. */
    model?: string;
    codexModel?: string;
    maxTokens?: number;
    signal?: AbortSignal;
    onToken?: (token: string) => void;
  },
): Promise<{ text: string; citations: Citation[] }> {
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];
  const maxTokens = options.maxTokens ?? 4096;

  if (options.mode === 'free') {
    // Codex does not usefully stream — measured, it emits an item at a time
    // rather than tokens — so this asks for the whole turn and hands it over in
    // one go. The caller has already told the reader to expect that.
    const client = getGroundedCodexClient();
    const response = await client.chat.completions.create(
      { model: options.codexModel ?? DEFAULT_GROUNDED_CODEX_MODEL, messages, max_tokens: maxTokens },
      { signal: options.signal as any },
    );
    const message = response.choices[0]?.message;
    const text = message?.content ?? '';
    if (text) options.onToken?.(text);
    return { text, citations: readCitations(message) };
  }

  /**
   * OpenRouter's web plugin. `plugins` is not in the OpenAI SDK's request type
   * — it is an OpenRouter extension — so it is cast through. Sending it to a
   * non-OpenRouter base URL would simply be ignored, and this path always uses
   * the OpenRouter client.
   */
  const client = await getOpenRouterClient();
  const model = options.model ?? getFallbackModel();
  let text = '';
  /**
   * Accumulated, keyed by URL — NOT replaced.
   *
   * Measured: a grounded stream delivered eight citations across eight separate
   * frames, one apiece, interleaved with the content. Taking the latest frame's
   * annotations as the answer's citations kept exactly one of them and threw
   * the other seven away, so a well-sourced answer reported a single source.
   */
  const citationsByUrl = new Map<string, Citation>();

  const stream = await client.chat.completions.create(
    {
      model,
      messages,
      max_tokens: maxTokens,
      stream: true,
      plugins: [{ id: 'web', max_results: WEB_PLUGIN_MAX_RESULTS }],
    } as never,
    { signal: options.signal as any },
  );

  for await (const chunk of stream as unknown as AsyncIterable<{
    choices?: Array<{ delta?: { content?: string; annotations?: unknown }; message?: unknown }>;
  }>) {
    const choice = chunk.choices?.[0];
    const delta = choice?.delta?.content;
    if (delta) {
      text += delta;
      options.onToken?.(delta);
    }
    // Read from every frame and from both shapes: annotations are scattered
    // through the stream rather than gathered at the end, and nothing in the
    // contract says which field carries them.
    for (const c of [
      ...readCitations(choice?.delta),
      ...readCitations(choice?.message),
    ]) {
      if (!citationsByUrl.has(c.url)) citationsByUrl.set(c.url, c);
    }
  }

  return { text, citations: [...citationsByUrl.values()] };
}

// Target dimensionality for the research embedding space. text-embedding-3-large
// is 3072-dim natively; we request 1536 via the `dimensions` param so the vectors
// drop straight into the existing pgvector(1536) columns (fact.embedding,
// source_chunk.embedding) with better retrieval than 3-small at the same width.
// (No-op for a 1536-native model, so it's safe if EMBEDDING_MODEL is overridden.)
export const EMBEDDING_DIM = 1536;

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = await getOpenRouterClient();
  const model = getEmbeddingModel();

  const response = await withRetry(
    () =>
      client.embeddings.create({
        model,
        input: text,
        dimensions: EMBEDDING_DIM,
      }),
    'generateEmbedding',
  );

  const vec = response.data[0].embedding;
  // Fail loud on a wrong-width vector rather than writing it to a vector(1536)
  // column (which errors per-row) or comparing across spaces: catches a provider
  // that ignores/rejects `dimensions` or a model swap that changed the width.
  if (vec.length !== EMBEDDING_DIM) {
    throw new Error(`embedding width ${vec.length} != expected ${EMBEDDING_DIM} (model ${model})`);
  }
  return vec;
}

/** Max chars per input — well under the model's per-input token limit. */
const EMBED_MAX_INPUT_CHARS = 24000;
/** Inputs per request — keeps total request tokens bounded (mirrors file-index). */
const EMBED_BATCH_SIZE = 48;

/**
 * Batch-embed many texts with the SAME model as generateEmbedding (deepdive's
 * getEmbeddingModel), so the vectors share the fact/query vector space and can be
 * compared directly (used to embed source-material chunks). Returns one vector
 * per input, in order. Fails loud on a short response so vectors never misalign.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const client = await getOpenRouterClient();
  const model = getEmbeddingModel();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const inputs = texts.slice(i, i + EMBED_BATCH_SIZE).map((t) => t.slice(0, EMBED_MAX_INPUT_CHARS));
    const response = await withRetry(
      () => client.embeddings.create({ model, input: inputs, dimensions: EMBEDDING_DIM }),
      'generateEmbeddings',
    );
    const sorted = [...response.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (sorted.length !== inputs.length) {
      throw new Error(`generateEmbeddings count mismatch: got ${sorted.length} for ${inputs.length} inputs`);
    }
    for (const d of sorted) {
      const vec = d.embedding as number[];
      if (vec.length !== EMBEDDING_DIM) {
        throw new Error(`embedding width ${vec.length} != expected ${EMBEDDING_DIM} (model ${model})`);
      }
      out.push(vec);
    }
  }
  return out;
}

