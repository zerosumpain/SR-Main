import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { APIUserAbortError, APIConnectionTimeoutError } from 'openai';
import { getOpenAIClient, getModel, getOpenRouterClient, getEmbeddingModel, getFallbackModel, hasOpenRouter } from './keys';

// z.ai's glm-5-turbo / glm-5.1 spend a lot of reasoning time: a medium 2k-token
// completion measures ~25s end-to-end, and a large clustering prompt (up to 200
// facts) routinely exceeds 30s. A 30s ceiling therefore aborted nearly every
// real deepdive call (synthesis clustering + the report executive summary),
// surfacing as APIUserAbortError "every time". These are background / streamed
// operations, so a generous ceiling is acceptable; genuinely-stuck calls fall
// back to OpenRouter below (see isOurTimeoutAbort).
const ZAI_NONSTREAM_TIMEOUT_MS = 90_000;
// Idle gap between streamed tokens. Reasoning models can take >30s to emit the
// FIRST token, so allow 45s before the watchdog fires.
const ZAI_STREAM_IDLE_TIMEOUT_MS = 45_000;

function combineSignals(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  return AbortSignal.any([external, timeout]);
}

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
 * Returns true when an error indicates a rate-limit from z.ai or OpenRouter.
 * z.ai surfaces these as HTTP 429 (err.status) or proprietary code 1302 (err.code).
 */
export function isRateLimitError(err: any): boolean {
  if (err?.status === 429) return true;
  if (err?.code === '1302' || err?.code === 1302) return true;
  if (/rate.?limit/i.test(String(err?.message ?? ''))) return true;
  if (/rate.?limit/i.test(String(err?.error?.message ?? ''))) return true;
  return false;
}

/**
 * True for any abort/timeout error.
 *
 * The OpenAI SDK throws `APIUserAbortError` when an AbortSignal fires and
 * `APIConnectionTimeoutError` on its own timeout. CRITICAL: the SDK's error
 * classes inherit `Error.prototype.name` ("Error") — they do NOT set `.name` to
 * their class name — so an `err.name === 'APIUserAbortError'` check NEVER matches
 * a real SDK abort. Match by `instanceof` (and constructor name / message as a
 * belt-and-suspenders) instead. The native `.name` strings are kept for the
 * raw-`fetch` paths (e.g. fetch-page-text) and openRouterChat's own timeout.
 */
function isAbortError(err: any): boolean {
  if (err instanceof APIUserAbortError || err instanceof APIConnectionTimeoutError) return true;
  if (err?.constructor?.name === 'APIUserAbortError' || err?.constructor?.name === 'APIConnectionTimeoutError') return true;
  if (err?.message === 'Request was aborted.') return true;
  const name = err?.name;
  return name === 'AbortError' || name === 'APIUserAbortError' || name === 'TimeoutError';
}

/**
 * True when an abort came from OUR own timeout (z.ai was too slow), as opposed
 * to the CALLER cancelling via their signal. When the caller's signal is already
 * aborted we must NOT fall back — the work was cancelled on purpose. Otherwise an
 * abort means our ZAI_*_TIMEOUT_MS watchdog fired, so OpenRouter is a valid
 * fallback (haiku is fast and reliable for these summary/cluster calls).
 */
function isOurTimeoutAbort(err: any, externalSignal: AbortSignal | undefined): boolean {
  if (externalSignal?.aborted) return false;
  return isAbortError(err);
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
  const client = getOpenRouterClient();
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

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      // Never retry an abort/timeout: a caller-cancellation must propagate, and
      // our own timeout-abort should drop straight to the OpenRouter fallback in
      // the caller rather than burning 3× the (now 90s) timeout retrying z.ai.
      if (isAbortError(err)) throw err;
      const isRateLimit = err?.status === 429;
      const isLastAttempt = attempt === maxRetries;

      if (isLastAttempt) throw err;

      const delay = isRateLimit
        ? Math.min(2000 * Math.pow(2, attempt), 30000) // 2s, 4s, 8s for rate limits
        : 2000;

      console.error(`[deepdive] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}${isRateLimit ? ', rate limited' : ''}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

export async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
): Promise<string> {
  const client = getOpenAIClient();
  const model = getModel();
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
          { signal: combineSignals(options?.signal, ZAI_NONSTREAM_TIMEOUT_MS) as any },
        ),
      'chatCompletion',
    );
    return response.choices[0]?.message?.content ?? '';
  } catch (err: any) {
    if ((isRateLimitError(err) || isOurTimeoutAbort(err, options?.signal)) && hasOpenRouter()) {
      const fallbackModel = getFallbackModel();
      const why = isRateLimitError(err) ? 'rate-limited' : 'timed out';
      console.log(`[deepdive] chatCompletion: z.ai ${why}, falling back to OpenRouter ${fallbackModel}`);
      return openRouterChat(messages, { temperature, maxTokens, signal: options?.signal });
    }
    throw err;
  }
}

function parseJsonText<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    // Attempt to repair truncated JSON (e.g. from max_tokens cutoff)
    try {
      const repaired = repairJson(text);
      return JSON.parse(repaired) as T;
    } catch (err) {
      console.error('[deepdive] jsonCompletion: repair failed. Raw text was:', text.slice(0, 500));
      throw err;
    }
  }
}

export async function jsonCompletion<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
): Promise<T> {
  const client = getOpenAIClient();
  const model = getModel();
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
          { signal: combineSignals(options?.signal, ZAI_NONSTREAM_TIMEOUT_MS) as any },
        ),
      'jsonCompletion',
    );
    return parseJsonText<T>(response.choices[0]?.message?.content ?? '{}');
  } catch (err: any) {
    if ((isRateLimitError(err) || isOurTimeoutAbort(err, options?.signal)) && hasOpenRouter()) {
      const fallbackModel = getFallbackModel();
      const why = isRateLimitError(err) ? 'rate-limited' : 'timed out';
      console.log(`[deepdive] jsonCompletion: z.ai ${why}, falling back to OpenRouter ${fallbackModel}`);
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
  opts: { temperature: number; maxTokens: number; signal: AbortSignal; onToken?: (t: string) => void; disableThinking?: boolean },
): Promise<{ text: string; tokensUsed: number }> {
  // Watchdog: abort the stream if no token arrives within ZAI_STREAM_IDLE_TIMEOUT_MS.
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
    }, ZAI_STREAM_IDLE_TIMEOUT_MS);
  };
  resetIdleTimer();

  try {
    // The `thinking` field is z.ai-proprietary; cast to any to bypass SDK types,
    // then re-cast the result as the streaming type so the for-await loop is typed.
    const stream = (await (client.chat.completions.create as any)(
      {
        model,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: true,
        ...(opts.disableThinking ? { thinking: { type: 'disabled' } } : {}),
      },
      { signal: idleAc.signal as any },
    )) as AsyncIterable<import('openai/resources').ChatCompletionChunk>;

    let text = '';
    let tokensUsed = 0;
    for await (const chunk of stream) {
      resetIdleTimer();
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        opts.onToken?.(delta);
      }
      if (chunk.usage?.total_tokens) {
        tokensUsed = chunk.usage.total_tokens;
      }
    }
    return { text, tokensUsed };
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
    disableThinking?: boolean;
  },
): Promise<{ text: string; tokensUsed: number }> {
  const useOpenRouter = !!options?.model;
  const client = useOpenRouter ? getOpenRouterClient() : getOpenAIClient();
  const model = options?.model ?? getModel();
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
  // would receive duplicated/garbled output. (For z.ai's slow-reasoning case the
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
      disableThinking: options?.disableThinking,
    });
  } catch (err: any) {
    // Only fall back on the INITIAL create error (before any tokens); never mid-stream.
    // Also skip fallback if the caller already explicitly chose a model (useOpenRouter path).
    // A z.ai idle-timeout abort (our watchdog, not a caller cancellation) is
    // fallback-eligible just like a rate-limit.
    if (!useOpenRouter && !emittedAny && (isRateLimitError(err) || isOurTimeoutAbort(err, externalSignal)) && hasOpenRouter()) {
      const fallbackModel = getFallbackModel();
      const why = isRateLimitError(err) ? 'rate-limited' : 'timed out';
      console.log(`[deepdive] streamCompletion: z.ai ${why}, falling back to OpenRouter ${fallbackModel}`);
      const fallbackAc = new AbortController();
      if (externalSignal) {
        if (externalSignal.aborted) fallbackAc.abort(externalSignal.reason);
        else externalSignal.addEventListener('abort', () => fallbackAc.abort(externalSignal.reason), { once: true });
      }
      return runStream(getOpenRouterClient(), fallbackModel, messages, {
        temperature,
        maxTokens,
        signal: fallbackAc.signal,
        onToken,
        disableThinking: options?.disableThinking,
      });
    }
    throw err;
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenRouterClient();
  const model = getEmbeddingModel();

  const response = await withRetry(
    () =>
      client.embeddings.create({
        model,
        input: text,
      }),
    'generateEmbedding',
  );

  return response.data[0].embedding;
}

