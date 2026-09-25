import { describe, expect, it, vi, beforeEach } from 'vitest';

const recorded = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('$lib/events/store', () => ({
  recordPlatformEvent: vi.fn(async (e: Record<string, unknown>) => {
    recorded.push(e);
    return true;
  }),
}));

import {
  emit,
  on,
  onAll,
  PLATFORM_EVENT_TYPES,
  setRunChainDepth,
  clearRunChainDepth,
} from '../../../src/lib/events/platform-bus';
import { executionContext } from '$lib/context/execution';

beforeEach(() => {
  recorded.length = 0;
});

describe('platform event bus', () => {
  it('delivers an emitted event to a subscriber, with its payload', () => {
    const seen: Array<Record<string, unknown>> = [];
    const off = on('whoop_recovery_updated', (event) => seen.push(event as unknown as Record<string, unknown>));
    emit('whoop_recovery_updated', { recordsSynced: 3 });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: 'whoop_recovery_updated',
      payload: { recordsSynced: 3 },
      chainDepth: 0,
      originWorkflowId: null,
    });
    expect(typeof seen[0].id).toBe('string');
  });

  it('writes the event down, best-effort, with the same id it delivered', async () => {
    const event = emit('whatsapp.inbound', { text: 'hi' }, { source: 'test' });
    expect(await event.persisted).toBe(true);
    expect(recorded).toEqual([
      expect.objectContaining({ id: event.id, type: 'whatsapp.inbound', source: 'test', payload: { text: 'hi' } }),
    ]);
  });

  it('stops delivering once unsubscribed', () => {
    const handler = vi.fn();
    on('workflow.completed', handler)();
    emit('workflow.completed');
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps the old workflow_completed name working in both directions', () => {
    const handler = vi.fn();
    const off = on('workflow_completed', handler);
    emit('workflow.completed', { workflowId: 'A' });
    emit('workflow_completed', { workflowId: 'B' });
    off();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls.every((c) => c[0].type === 'workflow.completed')).toBe(true);
  });

  it('onAll subscribes to every catalogue type', () => {
    const handler = vi.fn();
    const off = onAll(handler);
    for (const type of PLATFORM_EVENT_TYPES) emit(type);
    off();
    expect(handler).toHaveBeenCalledTimes(PLATFORM_EVENT_TYPES.length);
  });

  it('an event raised inside a run carries that run as its origin, and its chain depth', async () => {
    setRunChainDepth('run-7', 2);
    const event = await executionContext.run(
      { workflowId: 'W', runId: 'run-7', nodeId: 'n', llmCalls: [] },
      async () => emit('notification.raised', { title: 't' }),
    );
    clearRunChainDepth('run-7');
    expect(event.originWorkflowId).toBe('W');
    expect(event.chainDepth).toBe(2);
  });

  it('publishing costs the publisher nothing but the events and context modules', async () => {
    // The point of the split: $lib/health emits without importing the workflow
    // engine. If this file grows an import of $lib/workflows, the closure that
    // took health from 308 files to 1,007 is back. The database is reached by a
    // lazy import of ./store, so it is not on the static graph either.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/lib/events/platform-bus.ts', 'utf8'),
    );
    const imports = [...source.matchAll(/^import .*? from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['$lib/context/execution', './catalogue', 'node:crypto', 'node:events'].sort());
  });
});
