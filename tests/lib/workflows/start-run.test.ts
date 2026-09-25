import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  workflow: [{ id: 'wf', name: 'Flow' }] as unknown[],
  nodes: [] as Array<Record<string, unknown>>,
  edges: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock('$lib/db/schema', () => ({
  workflows: { __t: 'workflows', id: 'id' },
  workflowNodes: { __t: 'nodes', workflowId: 'workflowId' },
  workflowEdges: { __t: 'edges', workflowId: 'workflowId' },
  workflowRuns: { __t: 'runs' },
}));
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));
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
    insert: () => ({ values: async (v: Record<string, unknown>) => void state.inserts.push(v) }),
  },
}));

const execute = vi.hoisted(() => vi.fn(async () => ({ status: 'completed' })));
vi.mock('$lib/workflows', () => ({ engine: { execute } }));
const finaliseRun = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/workflows/run-finalise', () => ({ finaliseRun, failRun: vi.fn(async () => {}) }));
vi.mock('$lib/workflows/observability-bus', () => ({ emitObs: vi.fn() }));
const enqueue = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/workflows/run-queue', () => ({ enqueue }));

import { loadDefinition, startTriggeredRun } from '$lib/workflows/start-run';
import { runChainDepth } from '$lib/events/platform-bus';

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
  execute.mockClear();
  finaliseRun.mockClear();
  enqueue.mockClear();
});
afterEach(() => {
  delete process.env.JKAI_RUN_WORKER;
});

describe('loadDefinition', () => {
  it('drops display-only nodes and the edges that touch them', async () => {
    const def = await loadDefinition('wf');
    expect(def?.nodes.map((n) => n.id)).toEqual(['t', 'n']);
    expect(def?.edges.map((e) => e.id)).toEqual(['e1']);
    expect(def?.nodes[1]).toMatchObject({ label: 'llm-call', config: { a: 1 }, position: { x: 1, y: 2 } });
  });

  it('is null for a workflow that no longer exists', async () => {
    state.workflow = [];
    expect(await loadDefinition('gone')).toBeNull();
  });
});

describe('startTriggeredRun', () => {
  it('records an event run with its input, executes, and finalises with the chain depth', async () => {
    const runId = await startTriggeredRun('wf', { event: { x: 1 } }, { label: 'test', chainDepth: 2 });
    expect(runId).toBeTruthy();
    expect(state.inserts[0]).toMatchObject({ id: runId, workflowId: 'wf', status: 'running', trigger: 'event', inputData: { event: { x: 1 } } });
    expect(runChainDepth(runId!)).toBe(2);
    await vi.waitFor(() => expect(finaliseRun).toHaveBeenCalled());
    expect(finaliseRun).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'wf', runId, chainDepth: 2, label: 'test' }));
  });

  it('enqueues instead of executing in worker mode', async () => {
    process.env.JKAI_RUN_WORKER = '1';
    const runId = await startTriggeredRun('wf', {}, { label: 'test' });
    expect(state.inserts[0]).toMatchObject({ status: 'pending' });
    expect(enqueue).toHaveBeenCalledWith(runId);
    expect(execute).not.toHaveBeenCalled();
  });

  it('starts nothing for a deleted workflow', async () => {
    state.workflow = [];
    expect(await startTriggeredRun('gone', {}, { label: 'test' })).toBeNull();
    expect(state.inserts).toHaveLength(0);
  });
});
