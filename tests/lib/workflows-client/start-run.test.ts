import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  workflow: [{ id: 'wf', name: 'Flow' }] as unknown[],
  nodes: [] as Array<Record<string, unknown>>,
  edges: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<{ table: string; values: unknown }>,
}));

vi.mock('$lib/db/schema', () => ({
  workflows: { __t: 'workflows', id: 'id' },
  workflowNodes: { __t: 'nodes', workflowId: 'workflowId' },
  workflowEdges: { __t: 'edges', workflowId: 'workflowId' },
  workflowRuns: { __t: 'runs' },
  nodeExecutions: { __t: 'execs' },
}));
vi.mock('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}) }));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: (t: { __t: string }) => ({
        where: () => {
          const rows = t.__t === 'nodes' ? state.nodes : t.__t === 'edges' ? state.edges : state.workflow;
          const p = Promise.resolve(rows) as Promise<unknown[]> & { limit: () => Promise<unknown[]> };
          p.limit = async () => rows;
          return p;
        },
      }),
    }),
    insert: (t: { __t: string }) => ({
      values: (v: unknown) => {
        state.inserts.push({ table: t.__t, values: v });
        const p = Promise.resolve() as Promise<void> & { onConflictDoNothing: () => { returning: () => Promise<unknown[]> } };
        p.onConflictDoNothing = () => ({ returning: async () => [{ id: 'ver-new' }] });
        return p;
      },
    }),
  },
}));

import {
  startRun,
  startTriggeredRun,
} from '$lib/workflows-client/start-run';

const inserted = (table: string) => state.inserts.filter((i) => i.table === table).map((i) => i.values);

beforeEach(() => {
  state.workflow = [{ id: 'wf', name: 'Flow' }];
  state.nodes = [
    { id: 't', type: 'trigger', config: {}, label: 'T', position: null },
    { id: 'n', type: 'llm-call', config: { a: 1 }, label: null, position: { x: 1, y: 2 } },
    { id: 'note', type: 'postit', config: {}, label: 'note', position: null },
  ];
  state.edges = [
    { id: 'e1', sourceNodeId: 't', targetNodeId: 'n', sourceHandle: null, targetHandle: null },
    { id: 'e2', sourceNodeId: 'n', targetNodeId: 'note', sourceHandle: null, targetHandle: null },
  ];
  state.inserts = [];
});
afterEach(() => {
  delete process.env.JKAI_RUN_WORKER;
});

const invoke = vi.hoisted(() => vi.fn());
vi.mock('$lib/workflows-client/runtime-client', () => ({ invokeWorkflowRuntime: invoke, decodeEngineResult: (r: unknown) => r }));
describe('remote run handoff', () => {
  it('passes input and chain depth to Workflows without writing or executing a local run', async () => {
    invoke.mockResolvedValue({ runId: 'remote-1', status: 'pending', result: null });
    expect(await startTriggeredRun('wf', { event: 'test' }, { label: 'event-bus', chainDepth: 3 })).toBe('remote-1');
    expect(invoke).toHaveBeenCalledWith({ action: 'start', options: expect.objectContaining({ workflowId: 'wf', trigger: 'event', input: { event: 'test' }, chainDepth: 3 }) });
    expect(inserted('runs')).toEqual([]);
  });
  it('surfaces an unavailable owner instead of executing locally', async () => {
    invoke.mockRejectedValue(new Error('Workflows unavailable'));
    await expect(startRun({ workflowId: 'wf', trigger: 'manual' })).rejects.toThrow('Workflows unavailable');
  });
});
