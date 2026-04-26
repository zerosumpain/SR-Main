import { describe, it, expect } from 'vitest';
import { reduceFeed, type FeedEvent } from '$lib/builds/feed';

describe('reduceFeed', () => {
  it('groups events by iterationId into iteration cards', () => {
    const evs: FeedEvent[] = [
      { kind: 'log', id: 1, type: 'system', content: 'Iter 1 start', iterationId: 'a' },
      { kind: 'live', type: 'stream_text', iterationId: 'a', streamId: 'a:0', delta: 'hello' },
      { kind: 'live', type: 'stream_thinking', iterationId: 'a', streamId: 'a:1', delta: 'thinking…' },
    ];
    const r = reduceFeed(evs);
    expect(r.iterations).toHaveLength(1);
    expect(r.iterations[0].id).toBe('a');
    expect(r.iterations[0].lanes.output).toBe('hello');
    expect(r.iterations[0].lanes.thinking).toContain('thinking');
    expect(r.iterations[0].systemLogs).toContain('Iter 1 start');
  });

  it('builds tool entries from start/delta/end stream', () => {
    const evs: FeedEvent[] = [
      {
        kind: 'live',
        type: 'stream_tool_start',
        iterationId: 'a',
        streamId: 'a:0',
        toolName: 'write',
      },
      { kind: 'live', type: 'stream_tool_delta', iterationId: 'a', streamId: 'a:0', delta: '{"path":"x"}' },
      { kind: 'live', type: 'stream_tool_end', iterationId: 'a', streamId: 'a:0', full: '{"path":"x"}' },
    ];
    const r = reduceFeed(evs);
    const tools = r.iterations[0].lanes.tools;
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: 'write', argsRaw: '{"path":"x"}', status: 'done' });
  });

  it('extracts proposedPlan from plan_proposed event', () => {
    const evs: FeedEvent[] = [
      {
        kind: 'live',
        type: 'plan_proposed',
        iterationId: '0',
        streamId: '0:0',
        full: '## Plan\n\n### Iteration 1: x\n- Milestone: m',
      },
    ];
    const r = reduceFeed(evs);
    expect(r.proposedPlan).toBe('## Plan\n\n### Iteration 1: x\n- Milestone: m');
  });

  it('parses persisted code logs back into tool entries', () => {
    const evs: FeedEvent[] = [
      { kind: 'log', id: 7, type: 'code', content: '```write\nhello world\n```', iterationId: 'b' },
    ];
    const r = reduceFeed(evs);
    expect(r.iterations[0].lanes.tools).toHaveLength(1);
    expect(r.iterations[0].lanes.tools[0]).toMatchObject({
      name: 'write',
      argsRaw: 'hello world',
      status: 'done',
    });
  });

  it('preserves first-seen order across iterations', () => {
    const evs: FeedEvent[] = [
      { kind: 'log', id: 1, type: 'system', content: 'a', iterationId: 'A' },
      { kind: 'log', id: 2, type: 'system', content: 'b', iterationId: 'B' },
      { kind: 'log', id: 3, type: 'system', content: 'c', iterationId: 'A' },
    ];
    const r = reduceFeed(evs);
    expect(r.iterations.map((it) => it.id)).toEqual(['A', 'B']);
  });
});
