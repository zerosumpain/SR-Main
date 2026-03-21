import { getOpenAIClient, getModel, getOpenRouterClient, getEmbeddingModel } from './keys';

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[deepdive] ${label} failed, retrying once:`, err);
    await new Promise((r) => setTimeout(r, 2000));
    return fn();
  }
}

export async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const client = getOpenAIClient();
  const model = getModel();

  const response = await withRetry(
    () =>
      client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
      }),
    'chatCompletion',
  );

  return response.choices[0]?.message?.content ?? '';
}

export async function jsonCompletion<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number },
): Promise<T> {
  const client = getOpenAIClient();
  const model = getModel();

  const response = await withRetry(
    () =>
      client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt + '\n\nYou MUST respond with valid JSON only. No markdown, no code blocks, no explanation.' },
          { role: 'user', content: userPrompt },
        ],
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 4096,
        response_format: { type: 'json_object' },
      }),
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

