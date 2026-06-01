import { describe, it, expect } from 'vitest';
import { adaptFrameToCanvasSse, adaptToolFrameToJobEvents } from '$lib/jkai/sse-adapter';
import type { SseFrame } from '$lib/jkai/hermes-client';

function frame(partial: Partial<SseFrame> & Pick<SseFrame, 'kind'>): SseFrame {
  return {
    chat_id: 'c1',
    message_id: 'm1',
    content: '',
    metadata: {},
    ts: 0,
    ...partial,
  } as SseFrame;
}

describe('adaptToolFrameToJobEvents', () => {
  it('maps a started tool frame to tool_start (top-level tool payload)', () => {
    const events = adaptToolFrameToJobEvents(
      frame({
        kind: 'tool',
        tool: { phase: 'started', tool: 'workflow_add_node', tool_call_id: 'tc1', args: { id: 'n1' }, summary: 'Adding node' },
      }),
    );
    expect(events).toEqual([
      { type: 'tool_start', tool: 'workflow_add_node', args: { id: 'n1' }, toolCallId: 'tc1', summary: 'Adding node' },
    ]);
  });

  it('accepts the alternate name/arguments/id field names', () => {
    const events = adaptToolFrameToJobEvents(
      frame({
        kind: 'tool',
        tool: { phase: 'started', name: 'save_memory', id: 'x9', arguments: { note: 'hi' } },
      }),
    );
    expect(events).toEqual([
      { type: 'tool_start', tool: 'save_memory', args: { note: 'hi' }, toolCallId: 'x9', summary: undefined },
    ]);
  });

  it('reads the tool payload nested under metadata.tool', () => {
    const events = adaptToolFrameToJobEvents(
      frame({ kind: 'tool', metadata: { tool: { phase: 'started', tool: 'ha_query_state' } } }),
    );
    expect(events).toEqual([
      { type: 'tool_start', tool: 'ha_query_state', args: {}, toolCallId: undefined, summary: undefined },
    ]);
  });

  it('maps a completed tool frame to a done tool_result', () => {
    const events = adaptToolFrameToJobEvents(
      frame({ kind: 'tool', tool: { phase: 'completed', tool: 'workflow_add_node', tool_call_id: 'tc1', result: { ok: true } } }),
    );
    expect(events).toEqual([
      { type: 'tool_result', tool: 'workflow_add_node', result: { ok: true }, status: 'done', toolCallId: 'tc1', summary: '{"ok":true}' },
    ]);
  });

  it('maps a failed tool frame to an error tool_result', () => {
    const events = adaptToolFrameToJobEvents(
      frame({ kind: 'tool', tool: { phase: 'failed', tool: 'workflow_add_node', tool_call_id: 'tc1', error: 'boom' } }),
    );
    expect(events).toEqual([
      { type: 'tool_result', tool: 'workflow_add_node', result: { error: 'boom' }, status: 'error', toolCallId: 'tc1', summary: 'boom' },
    ]);
  });

  it('maps a progress frame with a summary to a status event', () => {
    const events = adaptToolFrameToJobEvents(
      frame({ kind: 'tool', tool: { phase: 'progress', tool: 'workflow_create', summary: 'Planning workflow…' } }),
    );
    expect(events).toEqual([{ type: 'status', text: 'Planning workflow…' }]);
  });

  it('drops a progress frame with no summary', () => {
    expect(adaptToolFrameToJobEvents(frame({ kind: 'tool', tool: { phase: 'progress', tool: 'x' } }))).toEqual([]);
  });

  // --- defensive guards: malformed / unknown shapes must not throw ---

  it('returns [] for non-tool frames', () => {
    expect(adaptToolFrameToJobEvents(frame({ kind: 'send', content: 'hi' }))).toEqual([]);
  });

  it('returns [] for a tool frame with no payload', () => {
    expect(adaptToolFrameToJobEvents(frame({ kind: 'tool' }))).toEqual([]);
  });

  it('returns [] for a started frame missing a tool name', () => {
    expect(adaptToolFrameToJobEvents(frame({ kind: 'tool', tool: { phase: 'started' } }))).toEqual([]);
  });

  it('returns [] for an unknown phase', () => {
    expect(
      adaptToolFrameToJobEvents(frame({ kind: 'tool', tool: { phase: 'bogus' as unknown as 'started', tool: 'x' } })),
    ).toEqual([]);
  });
});

describe('adaptFrameToCanvasSse (tool frames)', () => {
  it('returns [] for tool frames so text/media streaming is unchanged', () => {
    expect(adaptFrameToCanvasSse(frame({ kind: 'tool', tool: { phase: 'started', tool: 'x' } }))).toEqual([]);
  });

  it('still maps a send frame to a token delta', () => {
    expect(adaptFrameToCanvasSse(frame({ kind: 'send', content: 'hello' }))).toEqual([{ type: 'token', delta: 'hello' }]);
  });
});
