import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The SDK is only installed on the host that actually runs the bridge, so it is
 * mocked here rather than imported — which is also what makes this the first
 * cover the runner has had. The logic under test is the event→chunk mapping:
 * Codex emits ITEM-level events carrying each item's full text so far, and the
 * runner has to diff them into incremental deltas, keep reasoning out of the
 * answer, and capture tool dispatches.
 */
let scriptedEvents: unknown[] = [];
const startThread = vi.fn(() => ({
  runStreamed: async (_prompt: string, _opts: unknown) => ({
    events: (async function* () {
      for (const e of scriptedEvents) yield e;
    })(),
  }),
}));

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    startThread(...args: unknown[]) {
      return startThread(...(args as []));
    }
  },
}));

const { runStreamed, runCapturingToolCalls } = await import('./codex-runner');

const drain = async (req: Parameters<typeof runStreamed>[0]) => {
  const out: Array<{ delta: string; reasoning?: string; done: boolean; toolCalls?: unknown }> = [];
  for await (const c of runStreamed(req)) out.push(c);
  return out;
};

const REQ = { model: 'gpt-5.6-terra', prompt: 'hi' };

beforeEach(() => {
  scriptedEvents = [];
  startThread.mockClear();
});

describe('runStreamed', () => {
  it('diffs an item that grows, rather than re-sending the whole text', async () => {
    scriptedEvents = [
      { type: 'item.updated', item: { id: 'm1', type: 'agent_message', text: 'Hello' } },
      { type: 'item.updated', item: { id: 'm1', type: 'agent_message', text: 'Hello there' } },
      { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 2 } },
    ];
    const chunks = await drain(REQ);
    expect(chunks.filter((c) => !c.done).map((c) => c.delta)).toEqual(['Hello', ' there']);
    expect(chunks.at(-1)).toMatchObject({ done: true, usage: { input_tokens: 1, output_tokens: 2 } });
  });

  // The whole point of the separate field: reasoning must never reach the
  // assistant bubble, or the reply reads as the model arguing with itself.
  it('puts reasoning on `reasoning` and never on `delta`', async () => {
    scriptedEvents = [
      { type: 'item.updated', item: { id: 'r1', type: 'reasoning', text: 'Think' } },
      { type: 'item.updated', item: { id: 'r1', type: 'reasoning', text: 'Thinking hard' } },
      { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Answer' } },
      { type: 'turn.completed', usage: null },
    ];
    const chunks = await drain(REQ);
    expect(chunks.filter((c) => c.reasoning).map((c) => c.reasoning)).toEqual(['Think', 'ing hard']);
    expect(chunks.map((c) => c.delta).join('')).toBe('Answer');
  });

  // Ids are only unique within a kind, so keying the high-water mark on the id
  // alone would make a reasoning item swallow an agent_message that shares it.
  it('tracks reasoning and message items with the same id separately', async () => {
    scriptedEvents = [
      { type: 'item.updated', item: { id: 'x', type: 'reasoning', text: 'aaaa' } },
      { type: 'item.updated', item: { id: 'x', type: 'agent_message', text: 'bb' } },
      { type: 'turn.completed', usage: null },
    ];
    const chunks = await drain(REQ);
    expect(chunks.find((c) => c.reasoning)?.reasoning).toBe('aaaa');
    expect(chunks.map((c) => c.delta).join('')).toBe('bb');
  });

  it('captures a tool dispatch and reports it on the final chunk', async () => {
    scriptedEvents = [
      { type: 'item.completed', item: { id: 't1', type: 'mcp_tool_call', tool: 'knowledge_search', arguments: { query: 'Broads' } } },
      { type: 'turn.completed', usage: null },
    ];
    const chunks = await drain({ ...REQ, toolServerUrl: 'http://127.0.0.1:5207/mcp/abc' });
    expect(chunks.at(-1)!.toolCalls).toEqual([{ name: 'knowledge_search', arguments: { query: 'Broads' } }]);
  });

  // A tool-bearing turn that answers in prose is the common case — it must
  // still stream, which is exactly what the old blocking capture path lost.
  it('streams text on a tool-bearing turn that calls nothing', async () => {
    scriptedEvents = [
      { type: 'item.updated', item: { id: 'm1', type: 'agent_message', text: 'No tools needed' } },
      { type: 'turn.completed', usage: null },
    ];
    const chunks = await drain({ ...REQ, toolServerUrl: 'http://127.0.0.1:5207/mcp/abc' });
    expect(chunks.filter((c) => !c.done).map((c) => c.delta)).toEqual(['No tools needed']);
    expect(chunks.at(-1)!.toolCalls).toBeUndefined();
  });

  it('deduplicates a tool call repeated across item events', async () => {
    scriptedEvents = [
      { type: 'item.started', item: { id: 't1', type: 'mcp_tool_call', tool: 'a', arguments: {} } },
      { type: 'item.completed', item: { id: 't1', type: 'mcp_tool_call', tool: 'a', arguments: {} } },
      { type: 'turn.completed', usage: null },
    ];
    const chunks = await drain({ ...REQ, toolServerUrl: 'http://x/mcp/1' });
    expect(chunks.at(-1)!.toolCalls).toHaveLength(1);
  });

  it('throws on a failed turn that produced no tool calls', async () => {
    scriptedEvents = [{ type: 'turn.failed', error: { message: 'model exploded' } }];
    await expect(drain(REQ)).rejects.toThrow('model exploded');
  });

  // A turn that dispatched a tool is usable even if it errored afterwards —
  // the caller can still run what it asked for.
  it('does not throw when a failure follows a captured tool call', async () => {
    scriptedEvents = [
      { type: 'item.completed', item: { id: 't1', type: 'mcp_tool_call', tool: 'a', arguments: {} } },
      { type: 'turn.failed', error: { message: 'aborted' } },
    ];
    const chunks = await drain({ ...REQ, toolServerUrl: 'http://x/mcp/1' });
    expect(chunks.at(-1)!.toolCalls).toHaveLength(1);
  });
});

describe('runCapturingToolCalls', () => {
  it('accumulates the streamed text into one result', async () => {
    scriptedEvents = [
      { type: 'item.updated', item: { id: 'm1', type: 'agent_message', text: 'Par' } },
      { type: 'item.updated', item: { id: 'm1', type: 'agent_message', text: 'Partial' } },
      { type: 'turn.completed', usage: null },
    ];
    const out = await runCapturingToolCalls({ ...REQ, toolServerUrl: 'http://x/mcp/1' });
    expect(out.text).toBe('Partial');
    expect(out.toolCalls).toBeUndefined();
  });

  it('reports captured tool calls', async () => {
    scriptedEvents = [
      { type: 'item.completed', item: { id: 't1', type: 'mcp_tool_call', tool: 'intel_find', arguments: { q: 1 } } },
      { type: 'turn.completed', usage: null },
    ];
    const out = await runCapturingToolCalls({ ...REQ, toolServerUrl: 'http://x/mcp/1' });
    expect(out.toolCalls).toEqual([{ name: 'intel_find', arguments: { q: 1 } }]);
  });
});
