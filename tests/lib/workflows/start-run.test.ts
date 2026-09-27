import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  workflow: [{ id: 'wf', name: 'Flow' }] as unknown[],
  nodes: [] as Array<Record<string, unknown>>,
  edges: [] as Array<Record<string, unknown>>,
  versions: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<{ table: string; values: unknown }>,
}));

vi.mock('$lib/db/schema', () => ({
  workflows: { __t: 'workflows', id: 'id' },
  workflowNodes: { __t: 'nodes', workflowId: 'workflowId' },
  workflowEdges: { __t: 'edges', workflowId: 'workflowId' },
  workflowRuns: { __t: 'runs' },
  workflowVersions: { __t: 'versions', id: 'id', workflowId: 'workflowId', hash: 'hash', definition: 'definition' },
  nodeExecutions: { __t: 'execs' },
}));
vi.mock('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}) }));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: (t: { __t: string }) => ({
        where: () => {
          const rows = t.__t === 'nodes' ? state.nodes : t.__t === 'edges' ? state.edges
            : t.__t === 'versions' ? state.versions : state.workflow;
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

const execute = vi.hoisted(() => vi.fn(async () => ({ status: 'completed' })));
vi.mock('$lib/workflows', () => ({ engine: { execute } }));
const finaliseRun = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/workflows/run-finalise', () => ({ finaliseRun, failRun: vi.fn(async () => {}) }));
vi.mock('$lib/workflows/observability-bus', () => ({ emitObs: vi.fn() }));
const enqueue = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/workflows/run-queue', () => ({ enqueue }));

import {
  loadDefinition,
  definitionHash,
  pinVersion,
  loadPinnedDefinition,
  startRun,
  startTriggeredRun,
} from '$lib/workflows/start-run';
import { runChainDepth } from '$lib/events/platform-bus';

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
  state.versions = [];
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

  it('keeps them for a linter that asks', async () => {
    const def = await loadDefinition('wf', { includeDisplayOnly: true });
    expect(def?.nodes.map((n) => n.id)).toEqual(['t', 'n', 'note']);
    expect(def?.edges).toHaveLength(2);
  });

  it('is null for a workflow that no longer exists', async () => {
    state.workflow = [];
    expect(await loadDefinition('gone')).toBeNull();
  });
});

describe('definitionHash', () => {
  const base = {
    id: 'wf', name: 'Flow',
    nodes: [{ id: 'a', type: 'x', label: 'A', position: { x: 0, y: 0 }, config: { p: 1, q: { r: 2, s: 3 } } }],
    edges: [],
  };
  it('ignores positions and key order (jsonb reorders keys)', () => {
    const moved = { ...base, nodes: [{ ...base.nodes[0], position: { x: 9, y: 9 }, config: { q: { s: 3, r: 2 }, p: 1 } }] };
    expect(definitionHash(moved)).toBe(definitionHash(base));
  });
  it('changes when behaviour can', () => {
    const edited = { ...base, nodes: [{ ...base.nodes[0], config: { p: 2, q: { r: 2, s: 3 } } }] };
    expect(definitionHash(edited)).not.toBe(definitionHash(base));
  });
});

describe('pinVersion / loadPinnedDefinition', () => {
  const def = { id: 'wf', name: 'Flow', nodes: [], edges: [] };
  it('reuses the row for an unchanged graph', async () => {
    state.versions = [{ id: 'ver-1' }];
    expect(await pinVersion('wf', def)).toBe('ver-1');
    expect(inserted('versions')).toHaveLength(0);
  });
  it('snapshots a graph it has not seen', async () => {
    expect(await pinVersion('wf', def)).toBe('ver-new');
    expect(inserted('versions')[0]).toMatchObject({ workflowId: 'wf', hash: definitionHash(def), definition: def });
  });
  it('a pinned run reads its snapshot, not the live graph', async () => {
    state.versions = [{ definition: { id: 'wf', name: 'Then', nodes: [], edges: [] } }];
    expect((await loadPinnedDefinition({ workflowId: 'wf', versionId: 'v' }))?.name).toBe('Then');
    expect((await loadPinnedDefinition({ workflowId: 'wf', versionId: null }))?.name).toBe('Flow');
  });
});

const invoke = vi.hoisted(() => vi.fn());
vi.mock('$lib/workflows/runtime-client', () => ({ invokeWorkflowRuntime: invoke, decodeEngineResult: (r: unknown) => r }));
describe('remote run handoff', () => {
  it('passes input and chain depth to Workflows without writing or executing a local run', async () => {
    invoke.mockResolvedValue({ runId: 'remote-1', status: 'pending', result: null });
    expect(await startTriggeredRun('wf', { event: 'test' }, { label: 'event-bus', chainDepth: 3 })).toBe('remote-1');
    expect(invoke).toHaveBeenCalledWith({ action: 'start', options: expect.objectContaining({ workflowId: 'wf', trigger: 'event', input: { event: 'test' }, chainDepth: 3 }) });
    expect(inserted('runs')).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
  it('surfaces an unavailable owner instead of executing locally', async () => {
    invoke.mockRejectedValue(new Error('Workflows unavailable'));
    await expect(startRun({ workflowId: 'wf', trigger: 'manual' })).rejects.toThrow('Workflows unavailable');
    expect(execute).not.toHaveBeenCalled();
  });
});
