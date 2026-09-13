import { describe, expect, it, vi } from 'vitest';
import { emit, on, onAll, PLATFORM_EVENT_TYPES } from '../../../src/lib/events/platform-bus';

describe('platform event bus', () => {
  it('delivers an emitted event to a subscriber, with its payload', () => {
    const seen: unknown[] = [];
    const off = on('strava_activity_synced', (event) => seen.push(event));
    emit('strava_activity_synced', { recordsSynced: 3 });
    off();
    expect(seen).toEqual([{ type: 'strava_activity_synced', payload: { recordsSynced: 3 } }]);
  });

  it('stops delivering once unsubscribed', () => {
    const handler = vi.fn();
    on('workflow_completed', handler)();
    emit('workflow_completed');
    expect(handler).not.toHaveBeenCalled();
  });

  it('onAll covers every declared type, so the dispatcher cannot miss one', () => {
    // The dispatcher used to list the three type names a second time at the
    // bottom of event-bus.ts. A fourth event type added to the union but not to
    // that list would have been publishable and never dispatched.
    const handler = vi.fn();
    const off = onAll(handler);
    for (const type of PLATFORM_EVENT_TYPES) emit(type);
    off();
    expect(handler).toHaveBeenCalledTimes(PLATFORM_EVENT_TYPES.length);
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
