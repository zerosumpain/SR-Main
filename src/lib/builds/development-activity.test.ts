import { expect, it } from 'vitest';
import { activityStatus, mergeActivityLogs } from './development-activity';
import { piLiveUpdate, piToolCode } from '$lib/jkai/pi-live';
const now = Date.parse('2026-09-07T18:20:00Z');
it('distinguishes a quiet command with a live worker from an overdue heartbeat', () => {
  expect(activityStatus({ status: 'running', heartbeatAt: new Date(now - 15000).toISOString() }, now - 240000, now)).toMatchObject({ warning: false, label: 'Worker responding — waiting for output' });
  expect(activityStatus({ status: 'running', heartbeatAt: new Date(now - 120000).toISOString() }, now - 240000, now)).toMatchObject({ warning: true, label: 'Worker heartbeat not confirmed' });
  expect(activityStatus({ status: 'running', heartbeatAt: new Date(now).toISOString() }, now - 1000, now).label).toBe('Receiving build output');
});
it('shows queued, paused, failed and owner-blocked states independently of socket connection', () => {
  expect(activityStatus({ status: 'queued' }, 0, now).label).toContain('waiting for a worker');
  expect(activityStatus({ status: 'paused' }, now, now).label).toBe('Build paused');
  expect(activityStatus({ status: 'failed', failure: { message: 'Provider rejected request' } }, now, now).detail).toContain('Provider rejected');
  expect(activityStatus({ status: 'running' }, now, now, true).label).toBe('Waiting for your decision');
});
it('deduplicates and bounds saved replay while preserving event order', () => {
  const log = (id: number) => ({ id, type: 'code', content: `line ${id}`, iterationId: 'i' });
  expect(mergeActivityLogs([log(3), log(1)], [log(2), log(3)]).map(l => l.id)).toEqual([1, 2, 3]);
  expect(mergeActivityLogs([], Array.from({ length: 300 }, (_, i) => log(i))).length).toBe(160);
});
it('streams actual Pi 0.84 toolcall events and isolates successive messages', () => {
  const start = piLiveUpdate({ type: 'toolcall_start', contentIndex: 0, partial: { content: [{ name: 'write' }] } }, 'i', 1)!;
  expect(start).toMatchObject({ type: 'stream_tool_start', toolName: 'write' });
  const delta = piLiveUpdate({ type: 'toolcall_delta', contentIndex: 0, delta: '{"content":"<h1>' }, 'i', 1)!;
  expect(delta).toMatchObject({ type: 'stream_tool_delta', streamId: start.streamId, delta: '{"content":"<h1>' });
  const end = piLiveUpdate({ type: 'toolcall_end', toolCall: { name: 'write', arguments: { path: 'page.svelte', content: '<h1>Rome</h1>' } } }, 'i', 1)!;
  expect(end.full).toContain('Rome');
  expect(piLiveUpdate({ type: 'toolcall_start' }, 'i', 2)!.streamId).not.toBe(start.streamId);
});

it('retains actual generated code and edits for saved output after reload', () => {
  expect(piToolCode({ path: 'page.svelte', content: '<h1>Rome</h1>\n<p>Planner</p>' })).toBe('page.svelte\n<h1>Rome</h1>\n<p>Planner</p>');
  expect(piToolCode({ path: 'page.svelte', oldText: 'broken', newText: 'fixed' })).toBe('page.svelte\nfixed');
  expect(piToolCode({ command: 'npm run check' })).toBe('npm run check');
  expect(piToolCode({ content: 'x'.repeat(40000) }).length).toBe(32000);
});
