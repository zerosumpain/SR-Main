import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every run now emits workflow_completed, event-started ones included, so the
// dispatcher must refuse the two ways that turns into a loop: a workflow
// triggering itself, and an unbounded A→B→A chain.

const state = vi.hoisted(() => ({
  schedules: [] as Array<{ id: string; workflowId: string; type: string; enabled: boolean; config: Record<string, unknown> }>,
}));

vi.mock('$lib/db/schema', () => ({
  workflowSchedules: { __t: 'schedules', type: 'type', enabled: 'enabled' },
  workflows: { __t: 'workflows', id: 'id' },
  workflowRuns: { __t: 'runs' },
  workflowNodes: { __t: 'nodes', workflowId: 'workflowId' },
  workflowEdges: { __t: 'edges', workflowId: 'workflowId' },
}));
vi.mock('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}) }));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: (t: { __t: string }) => {
        const rows =
          t.__t === 'schedules' ? state.schedules : t.__t === 'workflows' ? [{ id: 'wf', name: 'wf' }] : [];
        const q = Promise.resolve(rows) as Promise<unknown[]> & { where: () => typeof q; limit: () => typeof q };
        q.where = () => q;
        q.limit = () => q;
        return q;
      },
    }),
    insert: () => ({ values: async () => {} }),
  },
}));

const execute = vi.hoisted(() => vi.fn());
vi.mock('$lib/workflows', () => ({ engine: { execute } }));
const finaliseRun = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/workflows/run-finalise', () => ({ finaliseRun, failRun: vi.fn(async () => {}) }));

import { handlePlatformEvent, MAX_CHAIN_DEPTH } from '$lib/workflows/event-bus';

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue({ status: 'completed' });
  finaliseRun.mockClear();
  state.schedules = [
    { id: 's-self', workflowId: 'A', type: 'event', enabled: true, config: { eventType: 'workflow_completed' } },
    { id: 's-b', workflowId: 'B', type: 'event', enabled: true, config: { eventType: 'workflow_completed', sourceWorkflowId: 'A' } },
  ];
});

describe('event-bus workflow_completed dispatch', () => {
  it('never starts the workflow whose completion it is', async () => {
    await handlePlatformEvent({ type: 'workflow_completed', payload: { workflowId: 'A', runId: 'r1' } });
    const started = execute.mock.calls.map((c) => c[4]);
    expect(started).toEqual(['B']);
  });

  it('stops a chain at MAX_CHAIN_DEPTH', async () => {
    await handlePlatformEvent({
      type: 'workflow_completed',
      payload: { workflowId: 'A', runId: 'r1', chainDepth: MAX_CHAIN_DEPTH },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes the next depth on to the run it starts', async () => {
    await handlePlatformEvent({ type: 'workflow_completed', payload: { workflowId: 'A', runId: 'r1', chainDepth: 2 } });
    await vi.waitFor(() => expect(finaliseRun).toHaveBeenCalled());
    expect(finaliseRun).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'B', chainDepth: 3 }));
  });
});
