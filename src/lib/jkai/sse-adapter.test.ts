import { describe, it, expect, beforeEach } from 'vitest';
import { adaptToolFrameToJobEvents, __resetPendingToolArgs } from './sse-adapter';

/**
 * Hermes sends a tool's arguments on `started` and omits them on `completed`,
 * so a finished card had nothing to describe itself with — the direct cause of
 * "Done — read file" appearing one frame after "reading x.ts".
 */
describe('adaptToolFrameToJobEvents — args carried from start to completion', () => {
  const frame = (phase: string, extra: Record<string, unknown> = {}) =>
    ({ kind: 'tool', metadata: { tool: { phase, tool: 'read_file', tool_call_id: 'call_1', ...extra } } }) as never;

  beforeEach(() => __resetPendingToolArgs());

  it('summarises a completion using the arguments from its start frame', () => {
    adaptToolFrameToJobEvents(frame('started', { args: { path: '/home/john/app/src/thing.ts' } }));
    const [done] = adaptToolFrameToJobEvents(frame('completed', { result: 'clipped file contents…' }));
    expect(done).toMatchObject({ type: 'tool_result', tool: 'read_file', status: 'done' });
    expect((done as { summary?: string }).summary).toBe('Read thing.ts');
  });

  it('prefers arguments the completion frame carries itself', () => {
    adaptToolFrameToJobEvents(frame('started', { args: { path: '/a/from-start.ts' } }));
    const [done] = adaptToolFrameToJobEvents(frame('completed', { args: { path: '/a/from-completion.ts' }, result: 'x' }));
    expect((done as { summary?: string }).summary).toBe('Read from-completion.ts');
  });

  it('consumes the entry, so a repeated id cannot borrow a stale argument', () => {
    adaptToolFrameToJobEvents(frame('started', { args: { path: '/a/first.ts' } }));
    adaptToolFrameToJobEvents(frame('completed', { result: 'x' }));
    const [second] = adaptToolFrameToJobEvents(frame('completed', { result: 'x' }));
    expect((second as { summary?: string }).summary).toBe('Read a file');
  });

  it('carries args to a failure frame too', () => {
    adaptToolFrameToJobEvents(frame('started', { args: { path: '/a/broken.ts' } }));
    const [failed] = adaptToolFrameToJobEvents(frame('failed', { error: 'ENOENT' }));
    expect(failed).toMatchObject({ status: 'error' });
    expect((failed as { summary?: string }).summary).toContain('failed');
  });

  it('still defers to a summary Hermes supplied itself', () => {
    adaptToolFrameToJobEvents(frame('started', { args: { path: '/a/x.ts' } }));
    const [done] = adaptToolFrameToJobEvents(frame('completed', { result: 'x', summary: 'Hermes said this' }));
    expect((done as { summary?: string }).summary).toBe('Hermes said this');
  });

  it('does not leak when a tool never completes', () => {
    for (let i = 0; i < 600; i++) {
      adaptToolFrameToJobEvents({
        kind: 'tool',
        metadata: { tool: { phase: 'started', tool: 'read_file', tool_call_id: `leak_${i}`, args: { path: `/a/${i}.ts` } } },
      } as never);
    }
    // The oldest were shed; the most recent still resolves.
    const [done] = adaptToolFrameToJobEvents({
      kind: 'tool',
      metadata: { tool: { phase: 'completed', tool: 'read_file', tool_call_id: 'leak_599', result: 'x' } },
    } as never);
    expect((done as { summary?: string }).summary).toBe('Read 599.ts');
  });
});
