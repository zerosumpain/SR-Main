import { describe, it, expect, vi } from 'vitest';
import { llmRouterExecutor, llmRouterDef } from '$lib/workflows/nodes/llm-router';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: '',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
} as any;

// Shared mock create function so individual tests can control its return value
const mockCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: 'route_b' } }],
  usage: { prompt_tokens: 50, completion_tokens: 5 },
});

vi.mock('$lib/deepdive/keys', () => ({
  getOpenRouterClient: () => ({
    chat: { completions: { create: mockCreate } },
  }),
}));

const twoRoutes = JSON.stringify([
  { handle: 'route_a', description: 'First option' },
  { handle: 'route_b', description: 'Second option' },
]);

describe('llmRouterExecutor', () => {
  it('routes to the LLM-selected handle (route_b)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'route_b' } }],
      usage: { prompt_tokens: 50, completion_tokens: 5 },
    });
    const result = await llmRouterExecutor.execute(
      { text: 'some input' },
      { routes: twoRoutes, model: 'openai/gpt-4o-mini' },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('route_b');
    expect(result.output.selectedRoute).toBe('route_b');
  });

  it('falls back to first route if LLM returns unknown handle', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'unknown_handle' } }],
      usage: { prompt_tokens: 50, completion_tokens: 5 },
    });
    const result = await llmRouterExecutor.execute(
      { text: 'some input' },
      { routes: twoRoutes, model: 'openai/gpt-4o-mini' },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('route_a');
    expect(result.output.selectedRoute).toBe('route_a');
  });

  it('returns error on invalid routes JSON', async () => {
    const result = await llmRouterExecutor.execute(
      { text: 'some input' },
      { routes: 'not valid json', model: 'openai/gpt-4o-mini' },
      mockContext,
    );
    expect(result.output.error).toBe('Invalid routes JSON');
  });

  it('returns error on empty routes array', async () => {
    const result = await llmRouterExecutor.execute(
      { text: 'some input' },
      { routes: '[]', model: 'openai/gpt-4o-mini' },
      mockContext,
    );
    expect(result.output.error).toBe('No routes defined');
  });

  it('spreads input fields into output', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'route_a' } }],
      usage: { prompt_tokens: 50, completion_tokens: 5 },
    });
    const result = await llmRouterExecutor.execute(
      { foo: 'bar', count: 42 },
      { routes: twoRoutes, model: 'openai/gpt-4o-mini' },
      mockContext,
    );
    expect(result.output.foo).toBe('bar');
    expect(result.output.count).toBe(42);
  });

  it('has correct type', () => {
    expect(llmRouterExecutor.type).toBe('llm-router');
  });
});

describe('llmRouterDef', () => {
  it('is agentic category', () => {
    expect(llmRouterDef.category).toBe('agentic');
  });

  it('has route_a and route_b outputs by default', () => {
    expect(llmRouterDef.outputs.find((o) => o.name === 'route_a')).toBeDefined();
    expect(llmRouterDef.outputs.find((o) => o.name === 'route_b')).toBeDefined();
  });

  it('requires routes in configSchema', () => {
    expect(llmRouterDef.configSchema.required).toContain('routes');
  });

  it('has model dropdown in basicConfig', () => {
    const modelField = llmRouterDef.basicConfig?.find((f) => f.key === 'model');
    expect(modelField).toBeDefined();
    expect(modelField?.type).toBe('dropdown');
  });
});
