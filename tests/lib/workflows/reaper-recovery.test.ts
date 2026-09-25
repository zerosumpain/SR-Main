import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The reaper no longer just fails abandoned runs: in-process, a stale running
// run (or one the deploy drain parked as paused) goes to crash recovery.

const state = vi.hoisted(() => ({
  stale: [] as Array<{ id: string; status: string }>,
  failed: [] as unknown[],
}));
vi.mock('$lib/db/schema', () => ({ workflowRuns: { id: 'id', status: 'status', heartbeatAt: 'h', startedAt: 's' } }));
vi.mock('drizzle-orm', () => ({ and: () => ({}), eq: () => ({}), inArray: (_c: unknown, v: unknown) => v, isNull: () => ({}), lt: () => ({}), or: () => ({}), sql: () => ({}) }));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => state.stale }) }),
    update: () => ({ set: () => ({ where: async (ids: unknown) => void state.failed.push(ids) }) }),
  },
}));
vi.mock('$lib/workflows/trigger-ownership', () => ({ claimableTriggerSql: () => ({}) }));
const isRunInFlight = vi.hoisted(() => vi.fn((id: string) => id === 'mine'));
vi.mock('$lib/workflows/engine', () => ({ isRunInFlight }));
const recoverRun = vi.hoisted(() => vi.fn(async () => 'resumed'));
vi.mock('$lib/workflows/engine-resume', () => ({ recoverRun }));

import { reapStaleRuns } from '$lib/workflows/engine-runtime';

beforeEach(() => {
  state.failed = [];
  recoverRun.mockClear();
});
afterEach(() => {
  delete process.env.JKAI_RUN_WORKER;
});

describe('reapStaleRuns', () => {
  it('recovers running and drained runs, fails pending ones, leaves its own in-flight runs alone', async () => {
    state.stale = [
      { id: 'dead', status: 'running' },
      { id: 'drained', status: 'paused' },
      { id: 'queued', status: 'pending' },
      { id: 'mine', status: 'running' },
    ];
    expect(await reapStaleRuns(30_000)).toBe(3);
    expect(recoverRun.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['dead', 'drained']);
    expect(state.failed).toEqual([['queued']]);
  });

  it('in worker mode keeps the old behaviour: fail, never resume here', async () => {
    process.env.JKAI_RUN_WORKER = '1';
    state.stale = [{ id: 'dead', status: 'running' }];
    await reapStaleRuns();
    expect(recoverRun).not.toHaveBeenCalled();
    expect(state.failed).toEqual([['dead']]);
  });
});
