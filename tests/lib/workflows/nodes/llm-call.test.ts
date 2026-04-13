import { describe, it, expect, vi } from 'vitest';
import { llmCallExecutor, llmCallDef } from '$lib/workflows/nodes/llm-call';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
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

vi.mock('$lib/deepdive/keys', () => ({
  getOpenRouterClient: () => mockClient,
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
});
