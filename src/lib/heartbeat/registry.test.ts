import { describe, expect, it } from 'vitest';
import { getHandler, listHandlers } from './registry';

describe('heartbeat registry', () => {
  it('drives the schedulers that used to keep their own timers', () => {
    // Forge's per-row croner, the 04:00 model-routing croner and the monthly
    // voice-drift croner, plus the backlog grooming that ran on a page GET.
    for (const name of ['forge-schedules', 'model-routing', 'voice-drift', 'backlog-grooming']) {
      expect(getHandler(name)?.name).toBe(name);
    }
    const names = listHandlers().map((h) => h.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
