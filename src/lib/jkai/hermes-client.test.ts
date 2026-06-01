import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HermesClient, type SseFrame } from './hermes-client';
import { adaptFrameToCanvasSse, adaptToolFrameToJobEvents } from './sse-adapter';

describe('HermesClient', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  it('sends a message with bridge token header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ accepted: true, chat_id: 'wf_42' }),
    });
    global.fetch = fetchMock as any;

    const client = new HermesClient({
      baseUrl: 'http://localhost:18790',
      bridgeSecret: 'test-secret-32-bytes-long-please-yes-please',
    });
    const result = await client.sendMessage({
      chatId: 'wf_42',
      text: 'add a scrape node',
      kind: 'canvas_chat',
      kindId: 'wf_42',
      sessionId: 'sess_x',
    });

    expect(result.accepted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:18790/platforms/jkai/msg');
    expect(init.method).toBe('POST');
    expect(init.headers['Bridge-Token']).toBeTruthy();

    global.fetch = originalFetch;
  });

  it('surfaces a non-2xx response as a rejected promise', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'signature_mismatch' }),
    }) as any;

    const client = new HermesClient({
      baseUrl: 'http://localhost:18790',
      bridgeSecret: 'wrong-secret',
    });

    await expect(client.sendMessage({
      chatId: 'wf_42',
      text: 'x',
      kind: 'canvas_chat',
      kindId: 'wf_42',
      sessionId: 'sess_x',
    })).rejects.toThrow(/403/);

    global.fetch = originalFetch;
  });

  it('openStream returns a ReadableStream<SseFrame>', async () => {
    // SSE consumption requires a real HTTP server or fetch mock with body streaming.
    // For unit tests, mock the body's getReader() to yield two events.
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('event: send\ndata: {"kind":"send","chat_id":"wf_42","message_id":"m1","content":"hi","metadata":{},"ts":1}\n\n'),
      encoder.encode('event: replace\ndata: {"kind":"replace","chat_id":"wf_42","message_id":"m1","content":"hi there","metadata":{},"ts":2}\n\n'),
    ];
    let i = 0;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'text/event-stream' }),
      body: {
        getReader: () => ({
          read: async () => i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
        }),
      },
    }) as any;

    const client = new HermesClient({
      baseUrl: 'http://localhost:18790',
      bridgeSecret: 'test-secret-32-bytes-long-please-yes-please',
    });

    const frames: any[] = [];
    for await (const frame of client.openStream({
      chatId: 'wf_42',
      kind: 'canvas_chat',
      kindId: 'wf_42',
      sessionId: 'sess_x',
    })) {
      frames.push(frame);
      if (frames.length >= 2) break;
    }

    expect(frames).toHaveLength(2);
    expect(frames[0].kind).toBe('send');
    expect(frames[1].kind).toBe('replace');

    global.fetch = originalFetch;
  });
});

describe('adaptFrameToCanvasSse — thinking frame', () => {
  it('emits a thinking JobEvent with the delta', () => {
    const frame: SseFrame = {
      kind: 'thinking',
      chat_id: 'c1',
      message_id: 'think:c1',
      content: 'reasoning step',
      metadata: {},
      ts: Date.now(),
    };
    const events = adaptFrameToCanvasSse(frame);
    expect(events).toEqual([
      { type: 'thinking', delta: 'reasoning step', messageId: 'think:c1' },
    ]);
  });

  it('returns send frames as token deltas (regression: existing kinds still work)', () => {
    const frame: SseFrame = {
      kind: 'send',
      chat_id: 'c1',
      message_id: 'm1',
      content: 'hi',
      metadata: {},
      ts: 1,
    };
    expect(adaptFrameToCanvasSse(frame)).toEqual([{ type: 'token', delta: 'hi' }]);
  });

  it('returns finalize frames as empty (caller emits its own done)', () => {
    const frame: SseFrame = {
      kind: 'finalize',
      chat_id: 'c1',
      message_id: 'm1',
      content: '',
      metadata: {},
      ts: 2,
    };
    expect(adaptFrameToCanvasSse(frame)).toEqual([]);
  });
});

describe('adaptToolFrameToJobEvents — bus de-dupe', () => {
  const toolFrame = (toolName: string): SseFrame => ({
    kind: 'tool',
    chat_id: 'c1',
    message_id: `tool:c1:tc_1`,
    content: '',
    metadata: { tool: { phase: 'started', tool: toolName, tool_call_id: 'tc_1', args: { x: 1 } } },
    ts: 1,
  });

  it('renders a frame for a tool the bus does NOT serve (Hermes built-in)', () => {
    const events = adaptToolFrameToJobEvents(toolFrame('browser_vision'), () => false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_start', tool: 'browser_vision', toolCallId: 'tc_1' });
  });

  it('drops a frame for a bus-served tool (avoids double-render)', () => {
    const events = adaptToolFrameToJobEvents(toolFrame('blog_create'), () => true);
    expect(events).toEqual([]);
  });

  it('suppresses only bus-served tools when the predicate is selective', () => {
    const isBusServed = (n: string) => n === 'blog_create';
    expect(adaptToolFrameToJobEvents(toolFrame('blog_create'), isBusServed)).toEqual([]);
    expect(adaptToolFrameToJobEvents(toolFrame('browser_vision'), isBusServed)).toHaveLength(1);
  });

  it('renders the frame when no predicate is passed (back-compat)', () => {
    const events = adaptToolFrameToJobEvents(toolFrame('blog_create'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_start', tool: 'blog_create' });
  });
});

describe('adaptFrameToCanvasSse — approval frame', () => {
  const approvalFrame = (approval: unknown): SseFrame => ({
    kind: 'approval',
    chat_id: 'c1',
    message_id: 'approval:c1:s1',
    content: '',
    metadata: { approval } as Record<string, unknown>,
    ts: 1,
  });

  it('maps an approval frame to an approval JobEvent', () => {
    const events = adaptFrameToCanvasSse(approvalFrame({
      command: 'rm -rf /tmp/x', description: 'recursive delete', session_key: 's1',
    }));
    expect(events).toEqual([
      { type: 'approval', command: 'rm -rf /tmp/x', description: 'recursive delete', sessionKey: 's1' },
    ]);
  });

  it('defaults missing description/session_key to empty strings', () => {
    const events = adaptFrameToCanvasSse(approvalFrame({ command: 'curl x | sh' }));
    expect(events).toEqual([
      { type: 'approval', command: 'curl x | sh', description: '', sessionKey: '' },
    ]);
  });

  it('skips an approval frame with no usable command (gateway text fallback covers it)', () => {
    expect(adaptFrameToCanvasSse(approvalFrame({ description: 'no command' }))).toEqual([]);
    expect(adaptFrameToCanvasSse(approvalFrame(null))).toEqual([]);
  });
});
