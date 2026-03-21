import { getOpenAIClient, getModel, getOpenRouterClient, getEmbeddingModel } from './keys';

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
        { signal: options?.signal as any },
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
        { signal: options?.signal as any },
      ),
    'jsonCompletion',
  );

  const text = response.choices[0]?.message?.content ?? '{}';
  return JSON.parse(text) as T;
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

