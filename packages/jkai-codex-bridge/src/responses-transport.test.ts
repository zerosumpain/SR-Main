import { describe, it, expect } from 'vitest';
import { sseEvents, buildBody, sessionIdFor } from './responses-transport';

/**
 * The SSE reader.
 *
 * Tested on its own because the bug it exists to prevent is invisible in
 * production: a JSON event split across two TCP reads. It shows up as a rare
 * dropped delta on long answers — a word missing from the middle of a reply,
 * with nothing in the logs. Chunk boundaries here are deliberately hostile.
 */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

async function collect(s: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const ev of sseEvents(s)) out.push(ev);
  return out;
}

describe('sseEvents', () => {
  it('reads whole frames', async () => {
    const out = await collect(streamOf('data: {"type":"a"}\n\n', 'data: {"type":"b"}\n\n'));
    expect(out).toEqual([{ type: 'a' }, { type: 'b' }]);
  });

  it('reassembles an event split mid-JSON across reads', async () => {
    // The reason this module exists rather than a split('\n') one-liner.
    const out = await collect(streamOf('data: {"ty', 'pe":"split"}\n\n'));
    expect(out).toEqual([{ type: 'split' }]);
  });

  it('reassembles an event split on the frame boundary itself', async () => {
    const out = await collect(streamOf('data: {"type":"x"}\n', '\ndata: {"type":"y"}\n\n'));
    expect(out).toEqual([{ type: 'x' }, { type: 'y' }]);
  });

  it('handles several frames arriving in one read', async () => {
    const out = await collect(streamOf('data: {"type":"a"}\n\ndata: {"type":"b"}\n\n'));
    expect(out).toEqual([{ type: 'a' }, { type: 'b' }]);
  });

  it('skips [DONE] and blank payloads', async () => {
    const out = await collect(streamOf('data: [DONE]\n\n', 'data:\n\n', 'data: {"type":"a"}\n\n'));
    expect(out).toEqual([{ type: 'a' }]);
  });

  it('ignores non-data lines such as comments and event names', async () => {
    const out = await collect(streamOf(': keepalive\n\n', 'event: ping\n\n', 'data: {"type":"a"}\n\n'));
    expect(out).toEqual([{ type: 'a' }]);
  });

  it('drops one malformed frame without abandoning the stream', async () => {
    // A bad frame must cost one event, not the rest of the answer.
    const out = await collect(streamOf('data: {broken\n\n', 'data: {"type":"ok"}\n\n'));
    expect(out).toEqual([{ type: 'ok' }]);
  });

  it('ignores a trailing partial frame that never completes', async () => {
    const out = await collect(streamOf('data: {"type":"a"}\n\n', 'data: {"unterminated"'));
    expect(out).toEqual([{ type: 'a' }]);
  });

  it('handles a multi-byte character split across reads', async () => {
    // TextDecoder({stream:true}) matters: naive decoding yields a replacement char.
    const bytes = new TextEncoder().encode('data: {"t":"café"}\n\n');
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 15));
        c.enqueue(bytes.slice(15));
        c.close();
      },
    });
    expect(await collect(s)).toEqual([{ t: 'café' }]);
  });
});

describe('buildBody cache key', () => {
  const messages = [
    { role: 'system', content: 'You are jkai.' },
    { role: 'user', content: 'hi' },
  ] as any;

  it("prefers the caller's key, which survives a changing instructions tail", () => {
    expect(buildBody({ model: 'm', messages, promptCacheKey: 'jkai_stable' }).prompt_cache_key).toBe('jkai_stable');
  });

  it('falls back to hashing the instructions', () => {
    expect(buildBody({ model: 'm', messages }).prompt_cache_key).toMatch(/^jkai_/);
  });
});

describe('sessionIdFor', () => {
  it('gives one cache key the same session, so the upstream prompt cache can hit', () => {
    expect(sessionIdFor('wildmind:mind:JKai')).toBe(sessionIdFor('wildmind:mind:JKai'));
    expect(sessionIdFor('wildmind:mind:JKai')).not.toBe(sessionIdFor('wildmind:mind:Wren'));
  });

  it('is shaped like a v4 UUID', () => {
    expect(sessionIdFor('jkai_stable')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is fresh per request without a key', () => {
    expect(sessionIdFor(undefined)).not.toBe(sessionIdFor(undefined));
  });
});
