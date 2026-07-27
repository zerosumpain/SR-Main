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

// When Hermes supplies no `summary`, the adapter falls back to the worded
// summarizer in `$lib/workflows/chat/tool-summary` (outcome-first phrasing,
// not a raw JSON preview) — hence the expected summary strings below.
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
      { type: 'tool_start', tool: 'save_memory', args: { note: 'hi' }, toolCallId: 'x9', summary: 'saving a memory' },
    ]);
  });

  it('reads the tool payload nested under metadata.tool', () => {
    const events = adaptToolFrameToJobEvents(
      frame({ kind: 'tool', metadata: { tool: { phase: 'started', tool: 'ha_query_state' } } }),
    );
    expect(events).toEqual([
      { type: 'tool_start', tool: 'ha_query_state', args: {}, toolCallId: undefined, summary: 'querying a device' },
    ]);
  });

  it('maps a completed tool frame to a done tool_result', () => {
    const events = adaptToolFrameToJobEvents(
      frame({ kind: 'tool', tool: { phase: 'completed', tool: 'workflow_add_node', tool_call_id: 'tc1', result: { ok: true } } }),
    );
    expect(events).toEqual([
      { type: 'tool_result', tool: 'workflow_add_node', result: { ok: true }, status: 'done', toolCallId: 'tc1', summary: 'Done — workflow add node' },
    ]);
  });

  it('maps a failed tool frame to an error tool_result', () => {
    const events = adaptToolFrameToJobEvents(
      frame({ kind: 'tool', tool: { phase: 'failed', tool: 'workflow_add_node', tool_call_id: 'tc1', error: 'boom' } }),
    );
    expect(events).toEqual([
      { type: 'tool_result', tool: 'workflow_add_node', result: { error: 'boom' }, status: 'error', toolCallId: 'tc1', summary: 'workflow_add_node failed: boom' },
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

// Clarify cards. Before 2026-07-27 the adapter had no `clarify` branch at all,
// so the agent's `clarify` tool degraded to a numbered text list and was never
// used. Every field is read defensively because a malformed frame must be
// skipped, not thrown — the question also arrives as a plain `send` frame, so a
// skipped card still leaves an answerable question on screen.
describe('adaptFrameToCanvasSse — clarify', () => {
  it('maps a freeform clarify frame to a clarify JobEvent', () => {
    const out = adaptFrameToCanvasSse(
      frame({
        kind: 'clarify',
        metadata: {
          clarify: {
            clarify_id: 'abc123',
            session_key: 'sess_x',
            questions: [{ id: 'abc123', text: 'Which environment — staging or prod?' }],
          },
        },
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'clarify',
      clarifyId: 'abc123',
      questions: [{ id: 'abc123', text: 'Which environment — staging or prod?', kind: 'freeform' }],
    });
  });

  it('marks a question with choices as kind=choice and carries them through', () => {
    const out = adaptFrameToCanvasSse(
      frame({
        kind: 'clarify',
        metadata: {
          clarify: {
            clarify_id: 'q9',
            questions: [{ id: 'q9', text: 'Pick a tier', choices: ['a', 'b', 'c'] }],
          },
        },
      }),
    );
    const ev = out[0] as { questions: Array<{ kind: string; choices?: string[] }> };
    expect(ev.questions[0].kind).toBe('choice');
    expect(ev.questions[0].choices).toEqual(['a', 'b', 'c']);
  });

  it('drops blank choice entries rather than rendering empty options', () => {
    const out = adaptFrameToCanvasSse(
      frame({
        kind: 'clarify',
        metadata: {
          clarify: { clarify_id: 'q1', questions: [{ text: 'Pick', choices: ['x', '', '  ', 'y'] }] },
        },
      }),
    );
    const ev = out[0] as { questions: Array<{ choices?: string[]; id: string }> };
    expect(ev.questions[0].choices).toEqual(['x', 'y']);
    // No per-question id supplied → falls back to the clarify id.
    expect(ev.questions[0].id).toBe('q1');
  });

  it('skips a frame with no clarify payload', () => {
    expect(adaptFrameToCanvasSse(frame({ kind: 'clarify' }))).toEqual([]);
  });

  it('skips a frame with no clarify_id (unresolvable)', () => {
    const out = adaptFrameToCanvasSse(
      frame({ kind: 'clarify', metadata: { clarify: { questions: [{ text: 'hi' }] } } }),
    );
    expect(out).toEqual([]);
  });

  it('skips a frame whose questions are all unusable', () => {
    const out = adaptFrameToCanvasSse(
      frame({
        kind: 'clarify',
        metadata: { clarify: { clarify_id: 'q', questions: [{ text: '  ' }, null, 'nope'] } },
      }),
    );
    expect(out).toEqual([]);
  });
});
