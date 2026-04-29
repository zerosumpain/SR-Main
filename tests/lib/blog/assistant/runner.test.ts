import { describe, it, expect, vi } from 'vitest';
import { runAssistant } from '$lib/blog/assistant/runner';
import * as blog from '$lib/blog';

vi.mock('$lib/blog');

function fakeClient(scripted: Array<{ tool?: { name: string; args: Record<string, unknown> }; text?: string }>) {
  let i = 0;
  return {
    chat: {
      completions: {
        async create(_opts: unknown) {
          const step = scripted[i++];
          if (!step) throw new Error('out of scripted steps');
          if (step.tool) {
            return {
              choices: [{
                message: {
                  role: 'assistant', content: null,
                  tool_calls: [{
                    id: `call_${i}`, type: 'function',
                    function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) },
                  }],
                },
                finish_reason: 'tool_calls',
              }],
            };
          }
          return {
            choices: [{ message: { role: 'assistant', content: step.text ?? '' }, finish_reason: 'stop' }],
          };
        },
      },
    },
  };
}

const snapshot = {
  id: 1, title: 'old', excerpt: 'e', slug: 's',
  content: 'one. two. three.',
  contentFormat: 'html' as const, status: 'draft' as const,
  coverImageUrl: null, coverImageAlt: null, publishedAt: null,
  previewToken: 't', tags: [],
};

describe('runAssistant', () => {
  it('emits text + done for plain replies', async () => {
    vi.mocked(blog.getPostById).mockResolvedValue({ ...snapshot } as never);
    const client = fakeClient([{ text: 'hello' }]);
    const events: Array<{ type: string }> = [];
    for await (const e of runAssistant({
      postId: 1, userMessage: 'hi', history: [], client: client as never, model: 'm',
    })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
  });

  it('emits proposal events for tool calls', async () => {
    vi.mocked(blog.getPostById).mockResolvedValue({ ...snapshot } as never);
    const client = fakeClient([
      { tool: { name: 'update_title', args: { title: 'new' } } },
      { text: 'proposed' },
    ]);
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    for await (const e of runAssistant({
      postId: 1, userMessage: 'rename', history: [], client: client as never, model: 'm',
    })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(['proposal', 'text', 'done']);
    const proposal = events[0] as unknown as { proposal: { kind: string } };
    expect(proposal.proposal.kind).toBe('meta');
  });

  it('caps tool calls at 6', async () => {
    vi.mocked(blog.getPostById).mockResolvedValue({ ...snapshot } as never);
    const scripted = Array.from({ length: 8 }, () => ({ tool: { name: 'update_title', args: { title: 'x' } } }));
    const client = fakeClient(scripted);
    const events: Array<{ type: string }> = [];
    for await (const e of runAssistant({
      postId: 1, userMessage: 'spam', history: [], client: client as never, model: 'm',
    })) events.push(e);
    const proposalCount = events.filter((e) => e.type === 'proposal').length;
    expect(proposalCount).toBeLessThanOrEqual(6);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });
});
