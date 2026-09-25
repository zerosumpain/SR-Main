import { describe, it, expect, vi, beforeEach } from 'vitest';

// The re-run seeds its input from the node's latest recorded execution. It used
// to filter on status = 'completed', so a node that FAILED — the case Re-Run is
// for — was re-run against some older successful input, or none at all.

const cap = vi.hoisted(() => ({
  seedWhere: null as unknown,
  seedRows: [] as Array<{ inputData: unknown }>,
}));

vi.mock('$lib/db/schema', () => ({
  workflows: { __t: 'workflows', id: 'wf.id' },
  workflowNodes: { __t: 'nodes', id: 'node.id', workflowId: 'node.wf' },
  workflowRuns: { __t: 'runs' },
  nodeExecutions: {
    __t: 'execs',
    nodeId: 'exec.nodeId',
    status: 'exec.status',
    inputData: 'exec.inputData',
    completedAt: 'exec.completedAt',
    startedAt: 'exec.startedAt',
  },
}));
vi.mock('drizzle-orm', () => {
  const sqlTag = (strings: TemplateStringsArray, ...vals: unknown[]) => ({ op: 'sql', strings: [...strings], vals });
  return {
    eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
    and: (...conds: unknown[]) => ({ op: 'and', conds }),
    desc: (col: unknown) => ({ op: 'desc', col }),
    isNotNull: (col: unknown) => ({ op: 'isNotNull', col }),
    sql: sqlTag,
  };
});
vi.mock('$lib/db', () => {
  const db = {
    select: () => ({
      from: (t: { __t: string }) => ({
        where: (w: unknown) => {
          if (t.__t === 'workflows') return Promise.resolve([{ id: 'wf-1', name: 'wf' }]);
          if (t.__t === 'nodes') return Promise.resolve([{ id: 'n1', type: 'transform', config: {}, label: 'N', position: { x: 0, y: 0 } }]);
          cap.seedWhere = w;
          const chain = { orderBy: () => chain, limit: async () => cap.seedRows };
          return chain;
        },
      }),
    }),
    insert: () => ({
      values: () => {
        const p = Promise.resolve() as Promise<void> & { returning: () => Promise<Array<{ id: string }>> };
        p.returning = async () => [{ id: 'run-new' }];
        return p;
      },
    }),
  };
  return { db };
});

const runWorkflowAndPersist = vi.hoisted(() => vi.fn());
vi.mock('$lib/workflows/run-helpers', () => ({ runWorkflowAndPersist }));

import { POST } from './+server';

function flatten(p: unknown): Array<{ op: string; col?: unknown; val?: unknown }> {
  const node = p as { op: string; conds?: unknown[] };
  if (node?.op === 'and') return (node.conds ?? []).flatMap(flatten);
  return [node as { op: string; col?: unknown; val?: unknown }];
}

beforeEach(() => {
  runWorkflowAndPersist.mockReset();
  cap.seedWhere = null;
  cap.seedRows = [];
});

describe('POST /api/workflows/:id/nodes/:nodeId/run', () => {
  it('seeds from the latest recorded input regardless of status', async () => {
    cap.seedRows = [{ inputData: { from: 'the failed run' } }];
    await POST({
      params: { id: 'wf-1', nodeId: 'n1' },
      request: new Request('http://x', { method: 'POST', body: '{}' }),
    } as never);

    const conds = flatten(cap.seedWhere);
    expect(conds.some((c) => c.col === 'exec.status')).toBe(false);
    expect(conds).toContainEqual({ op: 'eq', col: 'exec.nodeId', val: 'n1' });
    expect(conds).toContainEqual({ op: 'isNotNull', col: 'exec.inputData' });
    expect(runWorkflowAndPersist).toHaveBeenCalledWith(
      expect.anything(),
      'run-new',
      { from: 'the failed run' },
      expect.objectContaining({ workflowId: 'wf-1' }),
    );
  });

  it('an explicit input wins over the recorded one', async () => {
    cap.seedRows = [{ inputData: { from: 'history' } }];
    await POST({
      params: { id: 'wf-1', nodeId: 'n1' },
      request: new Request('http://x', { method: 'POST', body: JSON.stringify({ input: { mine: 1 } }) }),
    } as never);
    expect(runWorkflowAndPersist.mock.calls[0][2]).toEqual({ mine: 1 });
  });
});
