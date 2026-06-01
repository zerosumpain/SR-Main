import { vi, describe, it, expect, beforeEach } from 'vitest';

// Regression test for the node_executions clobber bug: per-run node-execution
// UPDATEs must be scoped by BOTH runId AND nodeId. Because nodeId is the static
// graph-node id (reused on every run), scoping by nodeId alone would overwrite
// the status/IO/cost/timestamps of every prior run's execution of that node.
//
// Strategy: mock drizzle-orm's eq/and so we can capture the exact predicate
// passed to each `.where(...)`, mock $lib/db with a chainable stub that records
// which table each update targeted and what predicate it was filtered by, and
// mock the engine so the run resolves with one node output + one node error.
// Then assert that every nodeExecutions UPDATE was filtered by an and() over
// the run's id, not by nodeId alone.
//
// NOTE: vi.mock factories are hoisted above all top-level code, so any value a
// factory references must be created INSIDE the factory (or via vi.hoisted).
// The captured predicates live on a hoisted array shared with the test body.

const captured = vi.hoisted(() => ({ nodeExecUpdateWheres: [] as unknown[] }));

vi.mock('$lib/db/schema', () => ({
  nodeExecutions: { __table: 'node_executions', runId: 'col:runId', nodeId: 'col:nodeId' },
  workflowRuns: { __table: 'workflow_runs', id: 'col:id' },
  workflowNodes: { __table: 'workflow_nodes', id: 'col:id' },
}));

// eq/and return structured descriptors so assertions can inspect the predicate
// tree instead of matching opaque drizzle SQL objects.
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  and: (...conds: unknown[]) => ({ op: 'and', conds }),
}));

vi.mock('$lib/db', () => {
  let currentTable: { __table?: string } | null = null;
  const chain = {
    update: vi.fn((table: { __table?: string }) => {
      currentTable = table;
      return chain;
    }),
    set: vi.fn(() => chain),
    where: vi.fn((predicate: unknown) => {
      if (currentTable?.__table === 'node_executions') {
        captured.nodeExecUpdateWheres.push(predicate);
      }
      currentTable = null;
      return Promise.resolve();
    }),
  };
  return { db: chain };
});

// Engine resolves immediately with one completed node and one failed node, so
// both nodeExecutions UPDATE loops in runWorkflowAndPersist execute.
vi.mock('$lib/workflows', () => ({
  engine: {
    execute: vi.fn(() =>
      Promise.resolve({
        status: 'completed_with_errors' as const,
        error: null,
        healingHistory: [],
        nodeOutputs: new Map<string, unknown>([['node-A', { ok: true }]]),
        nodeErrors: new Map<string, string>([['node-B', 'boom']]),
        nodeInputs: new Map<string, unknown>(),
        nodeUsage: new Map<string, unknown>(),
        nodeStartTimes: new Map<string, Date>(),
      }),
    ),
  },
}));

vi.mock('$lib/workflows/event-bus', () => ({ emit: vi.fn() }));

vi.mock('../../../src/lib/workflows/events', () => ({
  emitWorkflowEvent: vi.fn(),
  onWorkflowEvent: vi.fn(() => () => {}),
}));
vi.mock('../../../src/lib/workflows/observability-bus', () => ({
  emitObs: vi.fn(),
}));

import { runWorkflowAndPersist } from '../../../src/lib/workflows/run-helpers';

describe('runWorkflowAndPersist node_executions scoping', () => {
  beforeEach(() => {
    captured.nodeExecUpdateWheres.length = 0;
  });

  it('scopes every node_executions UPDATE by runId AND nodeId', async () => {
    const runId = 'run-123';
    runWorkflowAndPersist(
      { id: 'wf-1', name: 'wf', nodes: [], edges: [] },
      runId,
      {},
      { workflowId: 'wf-1', label: 'test', selfHealing: false },
    );

    // The persistence writes happen in a detached promise chain after the
    // mocked engine resolves; flush microtasks until they land.
    for (let i = 0; i < 50 && captured.nodeExecUpdateWheres.length < 2; i++) {
      await Promise.resolve();
    }

    // One completed node + one failed node = two node_executions UPDATEs.
    expect(captured.nodeExecUpdateWheres).toHaveLength(2);

    for (const predicate of captured.nodeExecUpdateWheres) {
      const p = predicate as { op: string; conds?: { op: string; col: unknown; val: unknown }[] };
      // Must be an and(...) — a bare eq(nodeId) is the bug we're guarding.
      expect(p.op).toBe('and');
      const cols = p.conds!.map((c) => c.col);
      const vals = p.conds!.map((c) => c.val);
      // One condition must pin the runId column to this run's id.
      expect(cols).toContain('col:runId');
      expect(vals).toContain(runId);
      // The other must pin the nodeId column.
      expect(cols).toContain('col:nodeId');
    }
  });
});
