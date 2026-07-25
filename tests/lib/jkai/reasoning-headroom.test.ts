import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import { installUsageCapture } from '$lib/jkai/usage-capture';
import { isReasoningModel, REASONING_TOKEN_FLOOR } from '$lib/constants/default-models';

// The durable-ledger + workflow-rollup side effects are irrelevant here; stub
// them so the test only exercises the request-shaping path.
vi.mock('$lib/jkai/llm-usage-log', () => ({ recordDurableLLMCall: vi.fn() }));
vi.mock('$lib/workflows/execution-context', () => ({
  recordLLMCall: vi.fn(),
  executionContext: { getStore: () => undefined },
}));

/** Minimal fake SDK client — captures the params the wrapper actually sends. */
function fakeClient() {
  const seen: Array<Record<string, unknown>> = [];
  const client = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          seen.push(params);
          return { usage: { prompt_tokens: 1, completion_tokens: 1 } };
        },
      },
    },
  } as unknown as OpenAI;
  return { client, seen };
}

describe('isReasoningModel', () => {
  it('covers the GLM family and the DeepSeek V4 site default', () => {
    expect(isReasoningModel('z-ai/glm-5.2')).toBe(true);
    expect(isReasoningModel('deepseek/deepseek-v4-flash')).toBe(true);
    expect(isReasoningModel('deepseek/deepseek-v4-pro')).toBe(true);
  });

  it('does not match plain non-reasoning models', () => {
    expect(isReasoningModel('openai/gpt-4o-mini')).toBe(false);
    expect(isReasoningModel('google/gemini-3.5-flash')).toBe(false);
  });
});

describe('reasoning headroom at the gateway', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lifts a tight max_tokens to the floor for a reasoning model', async () => {
    const { client, seen } = fakeClient();
    installUsageCapture(client, 'openrouter');
    // 50 is what the workflow llm-router asks for — entirely consumed by
    // thinking, so the caller would otherwise get an empty string back.
    await client.chat.completions.create({
      model: 'deepseek/deepseek-v4-flash',
      max_tokens: 50,
      messages: [],
    } as never);
    expect(seen[0].max_tokens).toBe(REASONING_TOKEN_FLOOR);
  });

  it('leaves a generous budget alone', async () => {
    const { client, seen } = fakeClient();
    installUsageCapture(client, 'openrouter');
    await client.chat.completions.create({
      model: 'deepseek/deepseek-v4-flash',
      max_tokens: 8000,
      messages: [],
    } as never);
    expect(seen[0].max_tokens).toBe(8000);
  });

  it('never touches a non-reasoning model', async () => {
    const { client, seen } = fakeClient();
    installUsageCapture(client, 'openrouter');
    await client.chat.completions.create({
      model: 'openai/gpt-4o-mini',
      max_tokens: 50,
      messages: [],
    } as never);
    expect(seen[0].max_tokens).toBe(50);
  });

  it('leaves an unset max_tokens unset (the provider default applies)', async () => {
    const { client, seen } = fakeClient();
    installUsageCapture(client, 'openrouter');
    await client.chat.completions.create({ model: 'z-ai/glm-5.2', messages: [] } as never);
    expect(seen[0].max_tokens).toBeUndefined();
  });

  it('applies to streaming calls too, alongside include_usage', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const client = {
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            seen.push(params);
            return (async function* () {
              yield { usage: { prompt_tokens: 1, completion_tokens: 1 } };
            })();
          },
        },
      },
    } as unknown as OpenAI;
    installUsageCapture(client, 'openrouter');
    await client.chat.completions.create({
      model: 'deepseek/deepseek-v4-flash',
      max_tokens: 220,
      stream: true,
      messages: [],
    } as never);
    expect(seen[0].max_tokens).toBe(REASONING_TOKEN_FLOOR);
    expect((seen[0].stream_options as { include_usage?: boolean }).include_usage).toBe(true);
  });
});
