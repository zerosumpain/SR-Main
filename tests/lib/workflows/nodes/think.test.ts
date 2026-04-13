import { describe, it, expect, vi } from 'vitest';
import { thinkExecutor, thinkDef } from '$lib/workflows/nodes/think';
import type { ExecutionContext } from '$lib/workflows/types';

const mockCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: '<thinking>\nStep 1: Analyze.\nStep 2: Score is above threshold.\n</thinking>\n\nThe input passes quality checks.' } }],
  usage: { prompt_tokens: 100, completion_tokens: 50 },
});

vi.mock('$lib/deepdive/keys', () => ({
  getOpenRouterClient: () => ({
    chat: { completions: { create: mockCreate } },
  }),
}));

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: '',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

describe('thinkExecutor', () => {
  it('returns reasoning and conclusion as non-empty strings', async () => {
    const result = await thinkExecutor.execute(
      { score: 42 },
      { prompt: 'Evaluate the score.', model: 'openai/gpt-4o-mini', temperature: 0.3, maxTokens: 2048 },
      mockContext,
    );

    expect(typeof result.output.reasoning).toBe('string');
    expect(typeof result.output.conclusion).toBe('string');
    expect((result.output.reasoning as string).length).toBeGreaterThan(0);
    expect((result.output.conclusion as string).length).toBeGreaterThan(0);
  });

  it('extracts reasoning from <thinking> tags', async () => {
    const result = await thinkExecutor.execute(
      { score: 42 },
      { prompt: 'Evaluate the score.' },
      mockContext,
    );

    expect(result.output.reasoning).toBe('Step 1: Analyze.\nStep 2: Score is above threshold.');
  });

  it('extracts conclusion as text outside <thinking> tags', async () => {
    const result = await thinkExecutor.execute(
      { score: 42 },
      { prompt: 'Evaluate the score.' },
      mockContext,
    );

    expect(result.output.conclusion).toBe('The input passes quality checks.');
  });

  it('spreads input into output', async () => {
    const result = await thinkExecutor.execute(
      { score: 42, name: 'test' },
      { prompt: 'Evaluate the score.' },
      mockContext,
    );

    expect(result.output.score).toBe(42);
    expect(result.output.name).toBe('test');
  });

  it('handles response without <thinking> tags', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Just a plain answer without thinking tags.' } }],
      usage: { prompt_tokens: 50, completion_tokens: 20 },
    });

    const result = await thinkExecutor.execute(
      { data: 'test' },
      { prompt: 'Analyze this.' },
      mockContext,
    );

    expect(result.output.reasoning).toBe('');
    expect(result.output.conclusion).toBe('Just a plain answer without thinking tags.');
  });

  it('has correct type', () => {
    expect(thinkExecutor.type).toBe('think');
  });
});

describe('thinkDef', () => {
  it('is agentic category', () => {
    expect(thinkDef.category).toBe('agentic');
  });

  it('has prompt in required configSchema', () => {
    expect(thinkDef.configSchema.required).toContain('prompt');
  });

  it('has basicConfig with prompt, model, temperature, maxTokens', () => {
    const keys = thinkDef.basicConfig?.map((f) => f.key);
    expect(keys).toContain('prompt');
    expect(keys).toContain('model');
    expect(keys).toContain('temperature');
    expect(keys).toContain('maxTokens');
  });
});
