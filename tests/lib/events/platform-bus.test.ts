import { describe, expect, it, vi } from 'vitest';
import { emit, on, onAll, PLATFORM_EVENT_TYPES } from '../../../src/lib/events/platform-bus';

describe('platform event bus', () => {
  it('delivers an emitted event to a subscriber, with its payload', () => {
    const seen: unknown[] = [];
    const off = on('whoop_recovery_updated', (event) => seen.push(event));
    emit('whoop_recovery_updated', { recordsSynced: 3 });
    off();
    expect(seen).toEqual([{ type: 'whoop_recovery_updated', payload: { recordsSynced: 3 } }]);
  });

  it('stops delivering once unsubscribed', () => {
    const handler = vi.fn();
    on('workflow_completed', handler)();
    emit('workflow_completed');
    expect(handler).not.toHaveBeenCalled();
  });

  it('onAll subscribes to every declared type', () => {
    const handler = vi.fn();
    const off = onAll(handler);
    for (const type of PLATFORM_EVENT_TYPES) emit(type);
    off();
    expect(handler).toHaveBeenCalledTimes(PLATFORM_EVENT_TYPES.length);
  });

  it('derives the type union from the list, so a fourth event cannot be half-declared', async () => {
    // Looping over PLATFORM_EVENT_TYPES cannot prove the dispatcher covers the
    // union — it is looping over the half that would be wrong. The guarantee has
    // to be structural, so the union is `(typeof PLATFORM_EVENT_TYPES)[number]`.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/events/platform-bus.ts', 'utf8');
    expect(source).toContain('export type PlatformEventType = (typeof PLATFORM_EVENT_TYPES)[number]');
  });

  it('publishing costs the publisher nothing but this module', async () => {
    // The point of the split: $lib/health emits without importing the workflow
    // engine. If this file grows an import of $lib/workflows, the closure that
    // took health from 308 files to 1,007 is back.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/lib/events/platform-bus.ts', 'utf8')
    );
    const imports = [...source.matchAll(/^import .*?from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['events']);
  });
});
