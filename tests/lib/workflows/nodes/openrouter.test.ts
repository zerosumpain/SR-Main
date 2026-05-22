import { describe, it, expect, vi } from 'vitest';

const mockCreate = vi.fn().mockResolvedValue({
  id: 'gen-123',
  choices: [{ message: { content: 'Hello world' } }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
  model: 'openai/gpt-4o-mini',
});

const mockClient = {
  chat: { completions: { create: mockCreate } },
};

vi.mock('$lib/deepdive/keys', () => ({
  getOpenRouterClient: () => mockClient,
  loadKeys: () => ({ openrouterApiKey: 'test-key' }),
}));

// Mock fetch for list_models and get_usage
global.fetch = vi.fn();

import { openrouterExecutor, openrouterDef } from '$lib/workflows/nodes/openrouter';
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

describe('openrouterExecutor', () => {
  it('chat_completion returns response text', async () => {
    const result = await openrouterExecutor.execute(
      { topic: 'cats' },
      { operation: 'chat_completion', model: 'openai/gpt-4o-mini', userPrompt: 'Tell me about {{input.topic}}' },
      mockContext,
    );
    const output = result.output as { response: string; usage: { promptTokens: number; completionTokens: number } };
    expect(output.response).toBe('Hello world');
    expect(output.usage.promptTokens).toBe(10);
  });

  it('chat_completion interpolates userPrompt template', async () => {
    await openrouterExecutor.execute(
      { name: 'Alice' },
      { operation: 'chat_completion', model: 'openai/gpt-4o-mini', userPrompt: 'Hello {{input.name}}!' },
      mockContext,
    );
    const callArgs = mockCreate.mock.calls.at(-1)![0];
    const userMsg = callArgs.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toBe('Hello Alice!');
  });

  it('chat_completion includes system prompt when provided', async () => {
    await openrouterExecutor.execute(
      {},
      { operation: 'chat_completion', model: 'openai/gpt-4o-mini', systemPrompt: 'Be concise.', userPrompt: 'Hi' },
      mockContext,
    );
    const callArgs = mockCreate.mock.calls.at(-1)![0];
    const sysMsg = callArgs.messages.find((m: { role: string }) => m.role === 'system');
    expect(sysMsg?.content).toBe('Be concise.');
  });

  it('chat_completion includes model and completionTokens in output', async () => {
    const result = await openrouterExecutor.execute(
      {},
      { operation: 'chat_completion', model: 'openai/gpt-4o-mini', userPrompt: 'Hi' },
      mockContext,
    );
    const output = result.output as { model: string; usage: { promptTokens: number; completionTokens: number } };
    expect(output.model).toBe('openai/gpt-4o-mini');
    expect(output.usage.completionTokens).toBe(20);
  });

  it('list_models fetches from OpenRouter API', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'openai/gpt-4o', name: 'GPT-4o' }] }),
    } as Response);
    const result = await openrouterExecutor.execute({}, { operation: 'list_models' }, mockContext);
    const output = result.output as { models: { id: string; name: string }[]; count: number };
    expect(output.models).toHaveLength(1);
    expect(output.models[0].id).toBe('openai/gpt-4o');
    expect(output.count).toBe(1);
  });

  it('get_usage fetches key info from OpenRouter API', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { limit: 10, usage: 2.5 } }),
    } as Response);
    const result = await openrouterExecutor.execute({}, { operation: 'get_usage' }, mockContext);
    expect(result.output.usage).toBeDefined();
  });

  it('throws on unknown operation', async () => {
    await expect(
      openrouterExecutor.execute({}, { operation: 'unknown_op' }, mockContext),
    ).rejects.toThrow('Unknown OpenRouter operation: unknown_op');
  });

  it('has correct type', () => {
    expect(openrouterExecutor.type).toBe('openrouter');
  });
});

describe('openrouterDef', () => {
  it('is integration category', () => {
    expect(openrouterDef.category).toBe('integration');
  });

  it('has operation in configSchema', () => {
    expect(openrouterDef.configSchema.properties?.operation).toBeDefined();
  });

  it('has model in configSchema', () => {
    expect(openrouterDef.configSchema.properties?.model).toBeDefined();
  });

  it('has correct type', () => {
    expect(openrouterDef.type).toBe('openrouter');
  });
});
