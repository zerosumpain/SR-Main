import { getOpenAIClient, getModel, getOpenRouterClient, getEmbeddingModel } from './keys';

const ZAI_NONSTREAM_TIMEOUT_MS = 30_000;
const ZAI_STREAM_IDLE_TIMEOUT_MS = 30_000;

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

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
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

  const response = await withRetry(
    () =>
      client.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 4096,
        },
        { signal: combineSignals(options?.signal, ZAI_NONSTREAM_TIMEOUT_MS) as any },
      ),
    'chatCompletion',
  );

  return response.choices[0]?.message?.content ?? '';
}

export async function jsonCompletion<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
): Promise<T> {
  const client = getOpenAIClient();
  const model = getModel();

  const response = await withRetry(
    () =>
      client.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt + '\n\nYou MUST respond with valid JSON only. No markdown, no code blocks, no explanation.' },
            { role: 'user', content: userPrompt },
          ],
          temperature: options?.temperature ?? 0.3,
          max_tokens: options?.maxTokens ?? 4096,
          response_format: { type: 'json_object' },
        },
        { signal: combineSignals(options?.signal, ZAI_NONSTREAM_TIMEOUT_MS) as any },
      ),
    'jsonCompletion',
  );

  const text = response.choices[0]?.message?.content ?? '{}';
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

export async function streamCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    model?: string;
    onToken?: (token: string) => void;
  },
): Promise<{ text: string; tokensUsed: number }> {
  const useOpenRouter = !!options?.model;
  const client = useOpenRouter ? getOpenRouterClient() : getOpenAIClient();
  const model = options?.model ?? getModel();

  // Watchdog: abort the stream if no token arrives within ZAI_STREAM_IDLE_TIMEOUT_MS.
  // Uses an internal AbortController combined with the caller's signal.
  const idleAc = new AbortController();
  const externalSignal = options?.signal;
  const onExternalAbort = () => idleAc.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) idleAc.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
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
    const stream = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: options?.temperature ?? 0.5,
        max_tokens: options?.maxTokens ?? 2000,
        stream: true,
      },
      { signal: idleAc.signal as any },
    );

    let text = '';
    let tokensUsed = 0;
    for await (const chunk of stream) {
      resetIdleTimer();
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        options?.onToken?.(delta);
      }
      if (chunk.usage?.total_tokens) {
        tokensUsed = chunk.usage.total_tokens;
      }
    }
    return { text, tokensUsed };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
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

