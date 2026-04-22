import { describe, it, expect, vi } from 'vitest';

const { completion } = vi.hoisted(() => ({ completion: vi.fn() }));
vi.mock('$lib/workflows/nodes/llm-helpers', () => ({
  resolveLLMClient: vi.fn().mockResolvedValue({
    client: { chat: { completions: { create: (...a: any[]) => completion(...a) } } },
    model: 'test-model',
  }),
}));

import { stealthScrapeLlmExecutor } from '$lib/workflows/nodes/stealth-scrape-llm';

const ctx: any = { runId: 'r', emit: vi.fn(), getNodeOutput: () => undefined };

describe('stealthScrapeLlmExecutor', () => {
  it('asks the LLM to extract fields matching the supplied schema', async () => {
    completion.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ title: 'Engineer', salary: '£50k' }) } }],
    });

    const result = await stealthScrapeLlmExecutor.execute(
      { scraped: { pages: [{ url: 'https://x', fields: { html: '<h1>Engineer</h1><p>£50k</p>' } }] } },
      {
        sourcePath: 'input.scraped.pages[0].fields.html',
        schema: { type: 'object', properties: { title: { type: 'string' }, salary: { type: 'string' } } },
        model: 'test-model',
      },
      ctx,
    );

    expect(result.output.extracted).toEqual({ title: 'Engineer', salary: '£50k' });
  });

  it('loops over an array source and extracts for each item', async () => {
    completion.mockResolvedValueOnce({ choices: [{ message: { content: '{"name":"A"}' } }] });
    completion.mockResolvedValueOnce({ choices: [{ message: { content: '{"name":"B"}' } }] });

    const result = await stealthScrapeLlmExecutor.execute(
      { pages: [{ text: 'foo A bar' }, { text: 'foo B bar' }] },
      {
        sourcePath: 'input.pages',
        itemTextPath: 'text',
        schema: { type: 'object', properties: { name: { type: 'string' } } },
        model: 'test-model',
      },
      ctx,
    );
    expect(result.output.extracted).toEqual([{ name: 'A' }, { name: 'B' }]);
  });
});
