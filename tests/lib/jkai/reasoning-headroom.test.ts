import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import { installUsageCapture } from '$lib/llm/usage-capture';
import {
  DEFAULT_NODE_MAX_TOKENS,
  isReasoningModel,
  REASONING_TOKEN_FLOOR,
} from '$lib/constants/default-models';

// The durable-ledger + workflow-rollup side effects are irrelevant here; stub
// them so the test only exercises the request-shaping path.
vi.mock('$lib/llm/usage-log', () => ({ recordDurableLLMCall: vi.fn() }));
vi.mock('$lib/context/execution', () => ({
  recordLLMCall: vi.fn(),
  executionContext: { getStore: () => undefined },
}));

// Stand-in OpenRouter catalogue for the provider-cap clamp. `cap` is what
// `raw->'top_provider'->>'max_completion_tokens'` yields — a string, or null
// when the model advertises no completion ceiling. Read once per process and
// cached, so every test here sees this one catalogue.
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: async () => [
        { id: 'openai/gpt-4o-mini', cap: '16384' },
        { id: 'deepseek/deepseek-v4-flash', cap: null },
        { id: 'z-ai/glm-5.2', cap: '131072' },
        { id: 'z-ai/glm-pocket', cap: '1000' },
      ],
    }),
  },
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
    expect(isReasoningModel('mistralai/mistral-small')).toBe(false);
  });

  /**
   * Gemini 3.x Flash used to be asserted here as non-reasoning. Measured
   * 2026-08-14 against `google/gemini-3.5-flash` on a research synthesis: the
   * stream carried 3,251 characters of `delta.reasoning` and returned a
   * 421-character answer from a 2,000-token cap, the answer starting
   * mid-sentence because thinking had already spent the budget. It needs the
   * floor like any other reasoning model.
   */
  it('covers the gemini-3 flash family, which bills reasoning against max_tokens', () => {
    expect(isReasoningModel('google/gemini-3.5-flash')).toBe(true);
    expect(isReasoningModel('google/gemini-3.1-flash-lite-preview')).toBe(true);
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

describe('provider completion cap at the gateway', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clamps the 25000-token node default down to what the model allows', async () => {
    const { client, seen } = fakeClient();
    installUsageCapture(client, 'openrouter');
    await client.chat.completions.create({
      model: 'openai/gpt-4o-mini',
      max_tokens: DEFAULT_NODE_MAX_TOKENS,
      messages: [],
    } as never);
    expect(seen[0].max_tokens).toBe(16384);
  });

  it('leaves the budget alone when the model advertises no ceiling', async () => {
    const { client, seen } = fakeClient();
    installUsageCapture(client, 'openrouter');
    await client.chat.completions.create({
      model: 'deepseek/deepseek-v4-flash',
      max_tokens: DEFAULT_NODE_MAX_TOKENS,
      messages: [],
    } as never);
    expect(seen[0].max_tokens).toBe(DEFAULT_NODE_MAX_TOKENS);
  });

  it('leaves a model the catalogue has never seen alone', async () => {
    const { client, seen } = fakeClient();
    installUsageCapture(client, 'openrouter');
    await client.chat.completions.create({
      model: 'some-vendor/brand-new',
      max_tokens: DEFAULT_NODE_MAX_TOKENS,
      messages: [],
    } as never);
    expect(seen[0].max_tokens).toBe(DEFAULT_NODE_MAX_TOKENS);
  });

  it('never clamps a budget that is already under the ceiling', async () => {
    const { client, seen } = fakeClient();
    installUsageCapture(client, 'openrouter');
    await client.chat.completions.create({
      model: 'z-ai/glm-5.2',
      max_tokens: 8000,
      messages: [],
    } as never);
    expect(seen[0].max_tokens).toBe(8000);
  });

  it('wins over the reasoning floor when a model caps below it', async () => {
    const { client, seen } = fakeClient();
    installUsageCapture(client, 'openrouter');
    // The floor would lift 50 to 3000; the provider only accepts 1000.
    await client.chat.completions.create({
      model: 'z-ai/glm-pocket',
      max_tokens: 50,
      messages: [],
    } as never);
    expect(seen[0].max_tokens).toBe(1000);
  });
});
