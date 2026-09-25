import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  /** runId → parentRunId, walked by the depth guard. */
  parents: {} as Record<string, string | null>,
  interactions: [] as Array<{ id: number }>,
}));

vi.mock('$lib/db/schema', () => ({
  workflowRuns: { __t: 'runs', id: 'id', parentRunId: 'parentRunId' },
  workflowInteractions: { __t: 'interactions', id: 'id', runId: 'runId', resolvedAt: 'resolvedAt' },
}));
vi.mock('drizzle-orm', () => ({
  eq: (_c: unknown, v: unknown) => ({ v }),
  and: () => ({}),
  isNull: () => ({}),
}));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: (t: { __t: string }) => ({
        where: (w: { v?: string }) => ({
          limit: async () => t.__t === 'runs'
            ? (w?.v && w.v in state.parents ? [{ parentRunId: state.parents[w.v] }] : [])
            : state.interactions,
        }),
      }),
    }),
  },
}));

const cancelRun = vi.hoisted(() => vi.fn());
vi.mock('$lib/workflows', () => ({ engine: { cancelRun } }));

const childDef = {
  id: 'sub-wf', name: 'Sub',
  nodes: [
    { id: 'a', type: 'manual-trigger', config: {}, label: 'A', position: { x: 0, y: 0 } },
    { id: 'b', type: 'transform', config: {}, label: 'B', position: { x: 0, y: 0 } },
  ],
  edges: [{ id: 'e', sourceNodeId: 'a', targetNodeId: 'b' }],
};
const startRun = vi.hoisted(() => vi.fn());
const loadDefinition = vi.hoisted(() => vi.fn());
vi.mock('$lib/workflows/start-run', () => ({ startRun, loadDefinition }));

import { subWorkflowExecutor, MAX_SUBWORKFLOW_DEPTH } from '$lib/workflows/nodes/sub-workflow';
import { FatalError } from '$lib/workflows/errors';
import type { ExecutionContext } from '$lib/workflows/types';

function ctx(signal = new AbortController().signal): ExecutionContext {
  return {
    runId: 'parent-run', workflowId: 'parent-wf', workspaceDir: '/tmp', dryRun: false,
    emit: vi.fn(), getNodeOutput: vi.fn(), checkBreakpoint: vi.fn(), abortSignal: signal,
    getOutgoingEdges: () => [], getIncomingEdges: () => [], getNodeConfig: () => undefined,
  } as unknown as ExecutionContext;
}

function settles(status: string, extra: Record<string, unknown> = {}) {
  startRun.mockResolvedValue({
    runId: 'child-run',
    status: 'running',
    done: Promise.resolve({
      status,
      nodeOutputs: new Map([['a', { first: true }], ['b', { result: 42 }]]),
      nodeErrors: new Map(status === 'completed' ? [] : [['b', 'boom']]),
      ...extra,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.parents = { 'parent-run': null };
  state.interactions = [];
  loadDefinition.mockResolvedValue(childDef);
  settles('completed');
});

describe('sub-workflow executor — child runs', () => {
  it('refuses a missing workflowId as a fatal config error', async () => {
    await expect(subWorkflowExecutor.execute({}, {}, ctx())).rejects.toBeInstanceOf(FatalError);
  });

  it('starts a real child run under the parent and returns its sink output', async () => {
    const r = await subWorkflowExecutor.execute({ data: 1 }, { workflowId: 'sub-wf' }, ctx());
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'sub-wf', trigger: 'sub-workflow', input: { data: 1 }, parentRunId: 'parent-run', definition: childDef,
    }));
    expect(r.output).toEqual({ result: 42 });
    expect(r.metadata).toMatchObject({ subRunId: 'child-run', subStatus: 'completed' });
  });

  it('throws when the child fails or completes with errors', async () => {
    settles('failed', { error: 'kaput' });
    await expect(subWorkflowExecutor.execute({}, { workflowId: 'sub-wf' }, ctx())).rejects.toThrow('Sub-workflow failed: kaput');
    settles('completed_with_errors');
    await expect(subWorkflowExecutor.execute({}, { workflowId: 'sub-wf' }, ctx())).rejects.toThrow(/completed with errors — b: boom/);
  });

  it('a child waiting on a person makes the parent wait too', async () => {
    settles('awaiting_human');
    state.interactions = [{ id: 77 }];
    const r = await subWorkflowExecutor.execute({}, { workflowId: 'sub-wf' }, ctx());
    expect(r.pause).toEqual({ reason: 'awaiting_human', interactionId: 77 });
  });

  it(`refuses to nest deeper than ${MAX_SUBWORKFLOW_DEPTH}`, async () => {
    state.parents = { 'parent-run': 'p1', p1: 'p2', p2: 'p3', p3: 'p4', p4: 'p5', p5: null };
    await expect(subWorkflowExecutor.execute({}, { workflowId: 'sub-wf' }, ctx())).rejects.toThrow(/deeper than 5/);
    expect(startRun).not.toHaveBeenCalled();
  });

  it('cancels the child when the parent is cancelled', async () => {
    const c = new AbortController();
    let release!: () => void;
    startRun.mockResolvedValue({
      runId: 'child-run', status: 'running',
      done: new Promise((r) => { release = () => r({ status: 'failed', error: 'cancelled', nodeOutputs: new Map(), nodeErrors: new Map() }); }),
    });
    const p = subWorkflowExecutor.execute({}, { workflowId: 'sub-wf' }, ctx(c.signal));
    await vi.waitFor(() => expect(startRun).toHaveBeenCalled());
    c.abort();
    await vi.waitFor(() => expect(cancelRun).toHaveBeenCalledWith('child-run'));
    release();
    await expect(p).rejects.toThrow();
  });

  it('validates the input and output schemas at the boundary', async () => {
    const inputSchema = { type: 'object', required: ['city'] };
    await expect(subWorkflowExecutor.execute({}, { workflowId: 'sub-wf', inputSchema }, ctx())).rejects.toThrow(/input does not match/);
    expect(startRun).not.toHaveBeenCalled();
    const outputSchema = { type: 'object', properties: { result: { type: 'string' } } };
    await expect(subWorkflowExecutor.execute({}, { workflowId: 'sub-wf', outputSchema }, ctx())).rejects.toThrow(/output does not match/);
  });
});
