import { describe, it, expect, vi } from 'vitest';
import { llmCallExecutor, llmCallDef } from '$lib/workflows/nodes/llm-call';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: '',
  workspaceDir: '/tmp/test',
  dryRun: false,
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
  getOutgoingEdges: () => [],
  getIncomingEdges: () => [],
  getNodeConfig: () => undefined,
};

const mockCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: 'Mock LLM response' } }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
});

const mockClient = {
  chat: {
    completions: {
      create: mockCreate,
    },
  },
};

vi.mock('$lib/workflows/nodes/llm-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/workflows/nodes/llm-helpers')>()),
  resolveLLMClient: async () => ({ client: mockClient, model: 'openai/gpt-4o-mini' }),
}));

describe('llmCallExecutor', () => {
  it('returns response and usage', async () => {
    const result = await llmCallExecutor.execute(
      { topic: 'cats' },
      {
        model: 'openai/gpt-4o-mini',
        systemPrompt: 'You are helpful.',
        userPrompt: 'Tell me about {{input.topic}}.',
        temperature: 0.7,
        maxTokens: 100,
      },
      mockContext,
    );

    expect(result.output.response).toBe('Mock LLM response');
    expect(result.output.usage).toEqual({ promptTokens: 10, completionTokens: 20 });
  });

  it('interpolates templates in prompts', async () => {
    await llmCallExecutor.execute(
      { name: 'Alice' },
      {
        model: 'openai/gpt-4o-mini',
        systemPrompt: 'System prompt.',
        userPrompt: 'Hello {{input.name}}!',
        temperature: 0.5,
        maxTokens: 50,
      },
      mockContext,
    );

    const callArgs = mockCreate.mock.calls.at(-1)![0];
    const userMsg = callArgs.messages.find((m: any) => m.role === 'user');
    expect(userMsg.content).toBe('Hello Alice!');
  });

  it('has correct type', () => {
    expect(llmCallExecutor.type).toBe('llm-call');
  });
});

describe('llmCallDef', () => {
  it('is core category', () => {
    expect(llmCallDef.category).toBe('core');
  });
  it('has model in configSchema', () => {
    expect(llmCallDef.configSchema.properties?.model).toBeDefined();
  });
  it('exposes outputSchema config + an llmDescription', () => {
    expect(llmCallDef.configSchema.properties?.outputSchema).toBeDefined();
    expect(llmCallDef.llmDescription).toBeTruthy();
  });
});

describe('llmCallExecutor — structured output', () => {
  const schema = {
    type: 'object',
    properties: { sentiment: { type: 'string' }, score: { type: 'number' } },
    required: ['sentiment', 'score'],
  };

  it('parses a valid JSON response into data (raw text on response)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"sentiment":"positive","score":0.9}' } }],
      usage: { prompt_tokens: 5, completion_tokens: 8 },
    });
    const r = await llmCallExecutor.execute(
      { review: 'love it' },
      { model: 'openai/gpt-4o-mini', userPrompt: 'Classify {{input.review}}', outputSchema: schema },
      mockContext,
    );
    expect(r.output.data).toEqual({ sentiment: 'positive', score: 0.9 });
    expect(r.output.response).toContain('positive');
  });

  it('strips code fences before parsing', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '```json\n{"sentiment":"neg","score":0.1}\n```' } }],
      usage: {},
    });
    const r = await llmCallExecutor.execute(
      {},
      { model: 'openai/gpt-4o-mini', userPrompt: 'x', outputSchema: schema },
      mockContext,
    );
    expect(r.output.data).toEqual({ sentiment: 'neg', score: 0.1 });
  });

  it('retries once when a required key is missing, then succeeds', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"sentiment":"positive"}' } }], // missing score
      usage: {},
    });
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"sentiment":"positive","score":0.7}' } }],
      usage: {},
    });
    const callsBefore = mockCreate.mock.calls.length;
    const r = await llmCallExecutor.execute(
      {},
      { model: 'openai/gpt-4o-mini', userPrompt: 'x', outputSchema: schema },
      mockContext,
    );
    expect(mockCreate.mock.calls.length - callsBefore).toBe(2);
    expect(r.output.data).toEqual({ sentiment: 'positive', score: 0.7 });
  });

  it('accepts a JSON-string outputSchema (from the code widget)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"sentiment":"ok","score":1}' } }],
      usage: {},
    });
    const r = await llmCallExecutor.execute(
      {},
      { model: 'openai/gpt-4o-mini', userPrompt: 'x', outputSchema: JSON.stringify(schema) },
      mockContext,
    );
    expect(r.output.data).toEqual({ sentiment: 'ok', score: 1 });
  });

  it('throws after one failed retry (into _onError path)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"foo":1}' } }],
      usage: {},
    });
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'still not valid' } }],
      usage: {},
    });
    await expect(
      llmCallExecutor.execute({}, { model: 'openai/gpt-4o-mini', userPrompt: 'x', outputSchema: schema }, mockContext),
    ).rejects.toThrow(/structured output invalid/i);
  });

  it('throws a clear error for an unparseable outputSchema string', async () => {
    await expect(
      llmCallExecutor.execute({}, { userPrompt: 'x', outputSchema: '{not json' }, mockContext),
    ).rejects.toThrow(/not valid JSON/i);
  });
});
