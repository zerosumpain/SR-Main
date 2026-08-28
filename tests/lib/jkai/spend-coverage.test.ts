/**
 * The three holes the LLM spend ledger used to have, asserted shut.
 *
 * Each `it` here corresponds to spend that was really being billed and really
 * was not being recorded, so the test names the gap rather than the mechanism:
 * if one of these goes red, a bill has gone invisible again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import { installUsageCapture } from '$lib/llm/usage-capture';
import { withActivity, currentActivityId } from '$lib/context/activity';

const recordDurableLLMCall = vi.fn();
vi.mock('$lib/llm/usage-log', () => ({
  recordDurableLLMCall: (...args: unknown[]) => recordDurableLLMCall(...args),
}));
vi.mock('$lib/context/execution', () => ({
  recordLLMCall: vi.fn(),
  executionContext: { getStore: () => undefined },
}));
vi.mock('$lib/context/research-meter', () => ({ currentResearchSessionId: () => null }));
vi.mock('$lib/db', () => ({ db: { select: () => ({ from: async () => [] }) } }));

/** Fake SDK client with BOTH surfaces the wrapper touches. */
function fakeClient(opts: { withEmbeddings?: boolean } = {}) {
  const client: Record<string, unknown> = {
    chat: {
      completions: {
        create: async () => ({ usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.5 } }),
      },
    },
  };
  if (opts.withEmbeddings !== false) {
    client.embeddings = {
      create: async () => ({
        data: [{ index: 0, embedding: [0.1] }],
        usage: { prompt_tokens: 4_000, total_tokens: 4_000, cost: 0.0004 },
      }),
    };
  }
  return client as unknown as OpenAI;
}

beforeEach(() => recordDurableLLMCall.mockClear());

describe('activity context', () => {
  it('is null outside a wrapped call, so nothing is mis-attributed by default', () => {
    expect(currentActivityId()).toBeNull();
  });

  it('does not leak out of the call it wrapped', async () => {
    await withActivity('vision', async () => {
      expect(currentActivityId()).toBe('vision');
    });
    expect(currentActivityId()).toBeNull();
  });

  it('survives the async frames between the wrapper and the SDK call', async () => {
    const seen = await withActivity('extraction', async () => {
      await new Promise((r) => setTimeout(r, 1));
      return (async () => currentActivityId())();
    });
    expect(seen).toBe('extraction');
  });
});

describe('gap 1: chat spend records which ROLE spent it', () => {
  it('tags the ledger row with the ambient activity', async () => {
    const client = installUsageCapture(fakeClient(), 'openrouter');
    await withActivity('doctor', () => client.chat.completions.create({ model: 'a/b', messages: [] }));
    expect(recordDurableLLMCall).toHaveBeenCalledTimes(1);
    expect(recordDurableLLMCall.mock.calls[0][0]).toMatchObject({
      activity: 'doctor',
      source: 'gateway',
      costUsd: 0.5,
    });
  });

  it('records a null activity — not a guessed one — outside any role', async () => {
    const client = installUsageCapture(fakeClient(), 'openrouter');
    await client.chat.completions.create({ model: 'a/b', messages: [] });
    expect(recordDurableLLMCall.mock.calls[0][0].activity).toBeNull();
  });

  it('carries cache reads and reasoning tokens through to the ledger', async () => {
    const client = {
      chat: {
        completions: {
          create: async () => ({
            usage: {
              prompt_tokens: 1_000,
              completion_tokens: 200,
              prompt_tokens_details: { cached_tokens: 800 },
              completion_tokens_details: { reasoning_tokens: 150 },
              cost: 0.01,
            },
          }),
        },
      },
      embeddings: { create: async () => ({ usage: {} }) },
    } as unknown as OpenAI;
    installUsageCapture(client, 'openrouter');
    await client.chat.completions.create({ model: 'a/b', messages: [] });
    expect(recordDurableLLMCall.mock.calls[0][0]).toMatchObject({
      cacheReadTokens: 800,
      reasoningTokens: 150,
    });
  });
});

describe('gap 2: embedding spend reaches the ledger at all', () => {
  it('records an embeddings call that used to be invisible', async () => {
    const client = installUsageCapture(fakeClient(), 'openrouter');
    await client.embeddings.create({ model: 'openai/text-embedding-3-large', input: ['x'] });
    expect(recordDurableLLMCall).toHaveBeenCalledTimes(1);
    expect(recordDurableLLMCall.mock.calls[0][0]).toMatchObject({
      model: 'openai/text-embedding-3-large',
      tokensInput: 4_000,
      // Zero, not null: an embeddings call really does emit no output tokens.
      tokensOutput: 0,
      costUsd: 0.0004,
    });
  });

  it('tags embeddings with the activity too', async () => {
    const client = installUsageCapture(fakeClient(), 'openrouter');
    await withActivity('embeddings', () => client.embeddings.create({ model: 'e/m', input: ['x'] }));
    expect(recordDurableLLMCall.mock.calls[0][0].activity).toBe('embeddings');
  });

  it('returns the response untouched, so callers still get their vectors', async () => {
    const client = installUsageCapture(fakeClient(), 'openrouter');
    const res = await client.embeddings.create({ model: 'e/m', input: ['x'] });
    expect(res.data[0].embedding).toEqual([0.1]);
  });

  it('records nothing rather than a zero when the provider reports no usage', async () => {
    const client = {
      chat: { completions: { create: async () => ({}) } },
      embeddings: { create: async () => ({ data: [], usage: undefined }) },
    } as unknown as OpenAI;
    installUsageCapture(client, 'openrouter');
    await client.embeddings.create({ model: 'e/m', input: ['x'] });
    expect(recordDurableLLMCall).not.toHaveBeenCalled();
  });

  it('never breaks a client that has no embeddings surface', () => {
    const client = fakeClient({ withEmbeddings: false });
    expect(() => installUsageCapture(client, 'openrouter')).not.toThrow();
  });
});
