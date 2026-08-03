import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The executor, not the writers.
 *
 * `mutate.server.ts` is mocked here on purpose: what this file has to prove is
 * that every write lands on the CALLER'S transaction handle and not on the
 * pool, that a failure halfway leaves nothing published, and that
 * `insert_between` produces the three edge changes John's sentence implies. The
 * writers' own rails (credential refusal, version bump, audit shape) are
 * covered in mutate.server.test.ts.
 */

const h = vi.hoisted(() => ({
  /** Rows the workflow-exists check resolves to. */
  workflowRows: [{ id: 'w1' }] as Array<Record<string, unknown>>,
  /** Per-table queues, consumed in call order, for the executor's own selects. */
  nodeSelects: [] as Array<Array<Record<string, unknown>>>,
  edgeSelects: [] as Array<Array<Record<string, unknown>>>,
  /** The handle `db.transaction` hands its callback. */
  tx: null as unknown,
  /** Every `tx` value the mocked writers were called with. */
  seenTx: [] as unknown[],
  /** Set to a node id to make `createNode` throw for it. */
  failCreateNodeLabel: null as string | null,
}));

vi.mock('$lib/db', () => {
  const nameOf = (t: unknown): string =>
    (t as Record<symbol, string>)?.[Symbol.for('drizzle:Name')] ?? 'unknown';
  const select = () => {
    const b: Record<string, unknown> = {};
    let table = 'workflows';
    b.from = (t: unknown) => {
      table = nameOf(t);
      return b;
    };
    b.where = () => {
      if (table === 'workflow_nodes') return Promise.resolve(h.nodeSelects.shift() ?? []);
      if (table === 'workflow_edges') return Promise.resolve(h.edgeSelects.shift() ?? []);
      return Promise.resolve(h.workflowRows);
    };
    return b;
  };
  const conn = { select };
  h.tx = { select };
  return {
    db: {
      ...conn,
      transaction: async (fn: (tx: unknown) => Promise<void>) => fn(h.tx),
    },
  };
});

vi.mock('$lib/jkai/workflow-updates-bus', () => ({
  publishWorkflowUpdate: vi.fn(),
}));

vi.mock('./mutate.server', () => {
  class NodeNotFoundError extends Error {
    constructor(nodeId: string) {
      super(`node not found: ${nodeId}`);
      this.name = 'NodeNotFoundError';
    }
  }
  class SensitiveRefusalError extends Error {
    fields: string[];
    constructor(fields: string[]) {
      super(`node config holds a credential (${fields.join(', ')})`);
      this.name = 'SensitiveRefusalError';
      this.fields = fields;
    }
  }
  class EdgeEndpointError extends Error {
    nodeIds: string[];
    constructor(nodeIds: string[]) {
      super(`not a node of this workflow: ${nodeIds.join(', ')}`);
      this.name = 'EdgeEndpointError';
      this.nodeIds = nodeIds;
    }
  }
  class EdgeNotFoundError extends Error {
    constructor(edgeId: string) {
      super(`edge not found: ${edgeId}`);
      this.name = 'EdgeNotFoundError';
    }
  }
  let seq = 0;
  return {
    NodeNotFoundError,
    SensitiveRefusalError,
    EdgeEndpointError,
    EdgeNotFoundError,
    nextNodePosition: vi.fn(async () => ({ x: 0, y: 0 })),
    createNode: vi.fn(async (input: Record<string, unknown>) => {
      h.seenTx.push(input.tx);
      if (h.failCreateNodeLabel && input.label === h.failCreateNodeLabel) {
        throw new SensitiveRefusalError(['apiKey']);
      }
      return {
        id: `node-${++seq}`,
        workflowId: input.workflowId,
        type: input.type,
        label: input.label,
        config: input.config ?? {},
        position: input.position ?? { x: 0, y: 0 },
        version: 0,
      };
    }),
    deleteNode: vi.fn(async (input: Record<string, unknown>) => {
      h.seenTx.push(input.tx);
      return { node: { id: input.nodeId, label: 'gone' }, edges: [{ id: 'e-old' }] };
    }),
    mutateNodeConfig: vi.fn(async (input: Record<string, unknown>) => {
      h.seenTx.push(input.tx);
      return {
        before: { nodeId: input.nodeId, version: 2, changedFields: { model: 'old' } },
        after: { version: 3 },
        node: { id: input.nodeId, type: 'llm-call', label: 'Ask', config: {}, position: {} },
      };
    }),
    createEdge: vi.fn(async (input: Record<string, unknown>) => {
      h.seenTx.push(input.tx);
      return {
        id: `edge-${++seq}`,
        workflowId: input.workflowId,
        sourceNodeId: input.sourceNodeId,
        targetNodeId: input.targetNodeId,
        sourceHandle: input.sourceHandle ?? null,
        targetHandle: input.targetHandle ?? null,
      };
    }),
    deleteEdge: vi.fn(async (input: Record<string, unknown>) => {
      h.seenTx.push(input.tx);
      if (input.edgeId === 'missing') throw new EdgeNotFoundError('missing');
      return { id: input.edgeId, sourceNodeId: 'a', targetNodeId: 'b' };
    }),
  };
});

import { publishWorkflowUpdate } from '$lib/jkai/workflow-updates-bus';
import { createEdge, createNode, deleteEdge, SensitiveRefusalError } from './mutate.server';
import { applyAmendOps, AmendOpError, WorkflowNotFoundError } from './amend.server';

const base = { workflowId: 'w1', actor: 'chat', reason: 'John asked' };

beforeEach(() => {
  h.workflowRows = [{ id: 'w1' }];
  h.nodeSelects = [];
  h.edgeSelects = [];
  h.seenTx = [];
  h.failCreateNodeLabel = null;
  vi.clearAllMocks();
});

describe('applyAmendOps', () => {
  it('refuses an unknown workflow before opening a transaction', async () => {
    h.workflowRows = [];
    await expect(
      applyAmendOps({ ...base, ops: [{ op: 'remove_edge', edgeId: 'e1' }] }),
    ).rejects.toBeInstanceOf(WorkflowNotFoundError);
    expect(deleteEdge).not.toHaveBeenCalled();
  });

  it('runs every write on the caller transaction, never on the pool', async () => {
    // The bug the whole change exists to close: a writer closing over the `db`
    // singleton runs outside the transaction, so a rollback leaves its rows.
    await applyAmendOps({
      ...base,
      ops: [
        { op: 'add_node', ref: 'delay', type: 'delay', label: 'Wait' },
        { op: 'add_edge', sourceNodeId: 'a', targetNodeId: '#delay' },
      ],
    });

    expect(h.seenTx).toHaveLength(2);
    expect(h.seenTx.every((t) => t === h.tx)).toBe(true);
  });

  it('resolves #ref to the id of a node created earlier in the same amend', async () => {
    await applyAmendOps({
      ...base,
      ops: [
        { op: 'add_node', ref: 'delay', type: 'delay', label: 'Wait' },
        { op: 'add_edge', sourceNodeId: 'a', targetNodeId: '#delay' },
      ],
    });

    const created = await vi.mocked(createNode).mock.results[0].value;
    expect(vi.mocked(createEdge).mock.calls[0][0]).toMatchObject({
      sourceNodeId: 'a',
      targetNodeId: created.id,
    });
  });

  it('fails the amend on an undeclared ref rather than writing a literal "#x"', async () => {
    const err = await applyAmendOps({
      ...base,
      ops: [{ op: 'add_edge', sourceNodeId: 'a', targetNodeId: '#nope' }],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AmendOpError);
    expect(err.message).toContain('unknown ref "#nope"');
    expect(createEdge).not.toHaveBeenCalled();
  });

  it('publishes nothing when a later op fails — a rolled-back graph must not reach an open canvas', async () => {
    const err = await applyAmendOps({
      ...base,
      ops: [
        { op: 'add_node', type: 'delay', label: 'Wait' },
        { op: 'remove_edge', edgeId: 'missing' },
        { op: 'add_edge', sourceNodeId: 'a', targetNodeId: 'b' },
      ],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AmendOpError);
    // Names the op the model has to fix, 1-based, and says nothing landed.
    expect(err.index).toBe(1);
    expect(err.message).toContain('op 2 (remove_edge)');
    expect(err.message).toContain('nothing was written');
    expect(publishWorkflowUpdate).not.toHaveBeenCalled();
    // The third op never ran.
    expect(createEdge).not.toHaveBeenCalled();
  });

  it('surfaces a credential refusal as the cause, with the field names intact', async () => {
    h.failCreateNodeLabel = 'Call the API';
    const err = await applyAmendOps({
      ...base,
      ops: [{ op: 'add_node', type: 'http-request', label: 'Call the API', config: {} }],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AmendOpError);
    expect(err.cause).toBeInstanceOf(SensitiveRefusalError);
    expect(err.cause.fields).toEqual(['apiKey']);
    expect(publishWorkflowUpdate).not.toHaveBeenCalled();
  });

  it('publishes only after the transaction closes', async () => {
    await applyAmendOps({
      ...base,
      ops: [{ op: 'add_node', type: 'delay', label: 'Wait' }],
    });
    expect(publishWorkflowUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(publishWorkflowUpdate).mock.calls[0][0]).toMatchObject({ kind: 'node_added' });
  });
});

describe('insert_between — the "delay before the WhatsApp send" case', () => {
  const source = { id: 'a', workflowId: 'w1', label: 'Scrape', position: { x: 0, y: 0 } };
  const target = { id: 'b', workflowId: 'w1', label: 'Send', position: { x: 400, y: 100 } };

  function primeGraph(edges: Array<Record<string, unknown>>) {
    h.nodeSelects = [[source], [target]];
    h.edgeSelects = [edges];
  }

  it('cuts the old edge and wires both halves, in one amend', async () => {
    primeGraph([{ id: 'e1', sourceNodeId: 'a', targetNodeId: 'b', sourceHandle: null, targetHandle: null }]);

    const res = await applyAmendOps({
      ...base,
      ops: [
        {
          op: 'insert_between',
          sourceNodeId: 'a',
          targetNodeId: 'b',
          type: 'delay',
          label: 'Wait 5m',
          config: { seconds: 300 },
        },
      ],
    });

    expect(deleteEdge).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteEdge).mock.calls[0][0]).toMatchObject({ edgeId: 'e1' });

    const created = await vi.mocked(createNode).mock.results[0].value;
    expect(vi.mocked(createEdge).mock.calls[0][0]).toMatchObject({
      sourceNodeId: 'a',
      targetNodeId: created.id,
    });
    expect(vi.mocked(createEdge).mock.calls[1][0]).toMatchObject({
      sourceNodeId: created.id,
      targetNodeId: 'b',
    });
    expect(res.outcomes[0].summary).toContain('spliced delay node "Wait 5m" between "Scrape" and "Send"');
  });

  it('sits the new node on the line it interrupts', async () => {
    primeGraph([{ id: 'e1', sourceNodeId: 'a', targetNodeId: 'b', sourceHandle: null, targetHandle: null }]);

    await applyAmendOps({
      ...base,
      ops: [{ op: 'insert_between', sourceNodeId: 'a', targetNodeId: 'b', type: 'delay', label: 'Wait' }],
    });

    expect(vi.mocked(createNode).mock.calls[0][0]).toMatchObject({ position: { x: 200, y: 50 } });
  });

  it('says which edge is missing instead of silently adding a floating node', async () => {
    primeGraph([]);

    const err = await applyAmendOps({
      ...base,
      ops: [{ op: 'insert_between', sourceNodeId: 'a', targetNodeId: 'b', type: 'delay', label: 'Wait' }],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AmendOpError);
    expect(err.message).toContain('there is no edge from "Scrape" to "Send"');
    expect(createNode).not.toHaveBeenCalled();
  });
});
