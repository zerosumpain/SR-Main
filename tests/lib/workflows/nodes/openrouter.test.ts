import { describe, it, expect, vi } from 'vitest';

// chat_completion routes through the resilient workflow gateway (timeout,
// concurrency, model failover) rather than a raw OpenRouter client, so that is
// what the test intercepts. list_models / get_usage still call the REST API
// directly, with the key from `getOpenRouterKey()` — the resolver that reads
// the app setting before keys.json, which is why it is async.
const mockChatCompletion = vi.fn().mockResolvedValue({
  id: 'gen-123',
  choices: [{ message: { content: 'Hello world' } }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
  model: 'openai/gpt-4o-mini',
});

vi.mock('$lib/llm/workflow-gateway', () => ({
  resilientChatCompletion: (...args: unknown[]) => mockChatCompletion(...args),
}));

vi.mock('$lib/llm/keys', () => ({
  getOpenRouterKey: async () => 'test-key',
}));

// Mock fetch for list_models and get_usage
global.fetch = vi.fn();

import { openrouterExecutor, openrouterDef } from '$lib/workflows/nodes/openrouter';
import { DEFAULT_NODE_MAX_TOKENS } from '$lib/constants/default-models';
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
    const body = mockChatCompletion.mock.calls.at(-1)![1];
    const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toBe('Hello Alice!');
  });

  it('chat_completion includes system prompt when provided', async () => {
    await openrouterExecutor.execute(
      {},
      { operation: 'chat_completion', model: 'openai/gpt-4o-mini', systemPrompt: 'Be concise.', userPrompt: 'Hi' },
      mockContext,
    );
    const body = mockChatCompletion.mock.calls.at(-1)![1];
    const sysMsg = body.messages.find((m: { role: string }) => m.role === 'system');
    expect(sysMsg?.content).toBe('Be concise.');
  });

  // This node used to fall back to the chat's alt-OpenRouter setting and then a
  // hardcoded openai/gpt-4o-mini, so "default" here meant something different
  // from "default" on every other LLM node. A blank model is now handed
  // straight to the gateway, which resolves the site default.
  it('chat_completion leaves a blank model for the site default to resolve', async () => {
    await openrouterExecutor.execute(
      {},
      { operation: 'chat_completion', model: '', userPrompt: 'Hi' },
      mockContext,
    );
    expect(mockChatCompletion.mock.calls.at(-1)![0]).toBe('');
  });

  it('chat_completion defaults the token ceiling to 25000', async () => {
    await openrouterExecutor.execute(
      {},
      { operation: 'chat_completion', userPrompt: 'Hi' },
      mockContext,
    );
    expect(mockChatCompletion.mock.calls.at(-1)![1].max_tokens).toBe(DEFAULT_NODE_MAX_TOKENS);
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
