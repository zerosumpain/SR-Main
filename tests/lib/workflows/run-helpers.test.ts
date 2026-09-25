import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// armRunWatchdog: an interactive run that goes quiet is failed and announced,
// and one that settles disarms both timers.

const state = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  listeners: new Map<string, (e: { type: string }) => void>(),
  emitted: [] as Array<{ type: string; runId: string }>,
}));

vi.mock('$lib/db/schema', () => ({ workflowRuns: { id: 'id' } }));
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));
vi.mock('$lib/db', () => ({
  db: { update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void state.updates.push(v) }) }) },
}));
vi.mock('$lib/workflows/events', () => ({
  emitWorkflowEvent: (e: { type: string; runId: string }) => state.emitted.push(e),
  onWorkflowEvent: (runId: string, fn: (e: { type: string }) => void) => {
    state.listeners.set(runId, fn);
    return () => state.listeners.delete(runId);
  },
}));

import { armRunWatchdog } from '$lib/workflows/run-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  state.updates = [];
  state.emitted = [];
  state.listeners.clear();
});
afterEach(() => vi.useRealTimers());

describe('armRunWatchdog', () => {
  it('fails a run that emits nothing for three minutes', async () => {
    armRunWatchdog('r1', 'test');
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 10);
    expect(state.updates[0]).toMatchObject({ status: 'failed' });
    expect(String(state.updates[0].error)).toMatch(/idle/);
    expect(state.emitted).toContainEqual(expect.objectContaining({ type: 'run_failed', runId: 'r1' }));
  });

  it('any event on the run resets the idle timer', async () => {
    armRunWatchdog('r2', 'test');
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    state.listeners.get('r2')!({ type: 'token' });
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(state.updates).toHaveLength(0);
  });

  it('disarms when the run settles', async () => {
    const disarm = armRunWatchdog('r3', 'test');
    disarm();
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(state.updates).toHaveLength(0);
    expect(state.listeners.has('r3')).toBe(false);
  });
});
