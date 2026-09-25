import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Records every write the finaliser makes, by table, so the tests can assert
// what was (and, for workflow_nodes, what was NOT) written.
const writes = vi.hoisted(() => ({
  updates: [] as Array<{ table: string; set: Record<string, unknown>; where: unknown }>,
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  /** node_executions rows that "exist" — an update on any other returns no row. */
  existingNodeRows: new Set<string>(),
}));

vi.mock('$lib/db/schema', () => ({
  nodeExecutions: { __table: 'node_executions', runId: 'col:runId', nodeId: 'col:nodeId', id: 'col:id' },
  workflowRuns: { __table: 'workflow_runs', id: 'col:id' },
  workflowNodes: { __table: 'workflow_nodes', id: 'col:id' },
}));
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  and: (...conds: unknown[]) => ({ op: 'and', conds }),
}));
vi.mock('$lib/db', () => {
  const db = {
    update: (table: { __table: string }) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: { op: string; conds?: Array<{ val: unknown }> }) => {
          writes.updates.push({ table: table.__table, set, where });
          const p = Promise.resolve() as Promise<void> & { returning: () => Promise<Array<{ id: string }>> };
          p.returning = async () => {
            if (table.__table !== 'node_executions') return [];
            const [run, node] = (where.conds ?? []).map((c) => c.val);
            return writes.existingNodeRows.has(`${run}:${node}`) ? [{ id: 'x' }] : [];
          };
          return p;
        },
      }),
    }),
    insert: (table: { __table: string }) => ({
      values: async (values: Record<string, unknown>) => {
        writes.inserts.push({ table: table.__table, values });
      },
    }),
  };
  return { db };
});

const emitPlatform = vi.hoisted(() => vi.fn());
vi.mock('$lib/events/platform-bus', () => ({ emit: emitPlatform, runChainDepth: () => 0, clearRunChainDepth: () => {} }));
const emitObs = vi.hoisted(() => vi.fn());
vi.mock('$lib/workflows/observability-bus', () => ({ emitObs }));
const recordFixProposalsFromHealing = vi.hoisted(() => vi.fn(async () => 1));
vi.mock('$lib/workflows/fix-proposals.server', () => ({ recordFixProposalsFromHealing }));

import { finaliseRun } from '$lib/workflows/run-finalise';
import type { EngineResult } from '$lib/workflows/engine';
import type { UndoEntry } from '$lib/workflows/types';

function result(over: Partial<EngineResult> = {}): EngineResult {
  return {
    status: 'completed',
    nodeOutputs: new Map([['n1', { ok: true }]]),
    nodeInputs: new Map([['n1', { in: 1 }]]),
    nodeErrors: new Map(),
    nodeUsage: new Map(),
    nodeStartTimes: new Map(),
    nodeSelectedHandles: new Map(),
    healingHistory: [],
    ...over,
  };
}

const heal: UndoEntry = {
  id: 'u1',
  runId: 'run-1',
  nodeId: 'n1',
  attempt: 1,
  timestamp: '2026-09-25T00:00:00Z',
  originalConfig: { a: 1 },
  newConfig: { a: 2 },
  fixDescription: 'bump a',
  retrySucceeded: true,
};

beforeEach(() => {
  writes.updates.length = 0;
  writes.inserts.length = 0;
  writes.existingNodeRows.clear();
  emitPlatform.mockClear();
  emitObs.mockClear();
  recordFixProposalsFromHealing.mockClear();
});

describe('finaliseRun', () => {
  it('never writes a heal back to workflow_nodes — it records a proposal instead', async () => {
    await finaliseRun({ workflowId: 'wf', runId: 'run-1', runStartedAt: Date.now(), result: result({ healingHistory: [heal] }) });
    expect(writes.updates.filter((u) => u.table === 'workflow_nodes')).toHaveLength(0);
    expect(recordFixProposalsFromHealing).toHaveBeenCalledWith('wf', 'run-1', [heal]);
    // The history is still kept on the run for the record.
    const runUpdate = writes.updates.find((u) => u.table === 'workflow_runs');
    expect(runUpdate?.set.healingHistory).toEqual([heal]);
  });

  it('emits workflow.completed for completed and completed_with_errors runs, with the run as origin', async () => {
    await finaliseRun({ workflowId: 'wf', runId: 'r1', runStartedAt: Date.now(), result: result() });
    await finaliseRun({ workflowId: 'wf', runId: 'r2', runStartedAt: Date.now(), result: result({ status: 'completed_with_errors' }) });
    expect(emitPlatform).toHaveBeenCalledWith(
      'workflow.completed',
      { workflowId: 'wf', runId: 'r1', status: 'completed' },
      expect.objectContaining({ originWorkflowId: 'wf', source: 'run-finalise' }),
    );
    expect(emitPlatform).toHaveBeenCalledWith(
      'workflow.completed',
      { workflowId: 'wf', runId: 'r2', status: 'completed_with_errors' },
      expect.anything(),
    );
  });

  it('carries the chain depth of an event-started run', async () => {
    await finaliseRun({ workflowId: 'wf', runId: 'r1', runStartedAt: Date.now(), result: result(), chainDepth: 2 });
    expect(emitPlatform).toHaveBeenCalledWith('workflow.completed', expect.anything(), expect.objectContaining({ chainDepth: 2 }));
  });

  it('does not emit workflow_completed for a failed or paused run', async () => {
    await finaliseRun({ workflowId: 'wf', runId: 'r1', runStartedAt: Date.now(), result: result({ status: 'failed', error: 'x' }) });
    await finaliseRun({ workflowId: 'wf', runId: 'r2', runStartedAt: Date.now(), result: result({ status: 'awaiting_human', pausedAtNodeId: 'n2' }) });
    expect(emitPlatform).not.toHaveBeenCalled();
  });

  it('a paused run saves pausedAtNodeId, leaves completedAt unset, and keeps the paused node input', async () => {
    await finaliseRun({
      workflowId: 'wf',
      runId: 'r1',
      runStartedAt: Date.now(),
      result: result({
        status: 'awaiting_human',
        pausedAtNodeId: 'appr',
        nodeInputs: new Map([['n1', { in: 1 }], ['appr', { in: 2 }]]),
      }),
    });
    const runUpdate = writes.updates.find((u) => u.table === 'workflow_runs');
    expect(runUpdate?.set).toMatchObject({ status: 'awaiting_human', pausedAtNodeId: 'appr' });
    expect(runUpdate?.set.completedAt).toBeUndefined();
    const paused = writes.inserts.find((i) => i.values.nodeId === 'appr');
    expect(paused?.values.inputData).toEqual({ in: 2 });
  });

  it('persists the selected handle and creates rows a start path never pre-created', async () => {
    await finaliseRun({
      workflowId: 'wf',
      runId: 'r1',
      runStartedAt: Date.now(),
      result: result({ nodeSelectedHandles: new Map([['n1', 'true']]) }),
    });
    expect(writes.inserts).toHaveLength(1);
    expect(writes.inserts[0].values).toMatchObject({ runId: 'r1', nodeId: 'n1', status: 'completed', selectedHandle: 'true' });
  });

  it('updates a pre-created row instead of inserting a second', async () => {
    writes.existingNodeRows.add('r1:n1');
    await finaliseRun({ workflowId: 'wf', runId: 'r1', runStartedAt: Date.now(), result: result() });
    expect(writes.inserts).toHaveLength(0);
    expect(writes.updates.filter((u) => u.table === 'node_executions')).toHaveLength(1);
  });

  it('records the input a failed node failed on', async () => {
    await finaliseRun({
      workflowId: 'wf',
      runId: 'r1',
      runStartedAt: Date.now(),
      result: result({ status: 'failed', nodeOutputs: new Map(), nodeErrors: new Map([['n1', 'boom']]) }),
    });
    expect(writes.inserts[0].values).toMatchObject({ status: 'failed', error: 'boom', inputData: { in: 1 } });
  });

  it('skips seeded nodes on the resume path', async () => {
    await finaliseRun({ workflowId: 'wf', runId: 'r1', runStartedAt: Date.now(), result: result(), seededNodeIds: new Set(['n1']) });
    expect(writes.inserts).toHaveLength(0);
    expect(writes.updates.filter((u) => u.table === 'node_executions')).toHaveLength(0);
  });
});

// Every start path must finalise through the one helper, and none may write a
// heal back to the saved node. Read as source because the paths are route
// handlers and detached promise chains that a unit test cannot reach cheaply.
describe('every run start path uses finaliseRun', () => {
  const SRC = path.resolve(__dirname, '../../../src');
  const START_PATHS = [
    'lib/workflows/run-helpers.ts',
    'routes/api/workflows/[id]/run/+server.ts',
    'lib/workflows/run-worker.ts',
    'lib/workflows/scheduler.ts',
    'lib/workflows/start-run.ts',
    'routes/api/workflows/webhook/[id]/+server.ts',
    'lib/workflows/engine-resume.ts',
  ];
  // Triggered starts (events, WhatsApp keywords, email) share start-run.ts,
  // which finalises; they must not carry their own copy of a run start.
  const TRIGGERED_PATHS = [
    'lib/workflows/event-bus.ts',
    'lib/workflows/gmail/orchestrator-bridge.ts',
    'lib/workflows/whatsapp/workflow-dispatch.ts',
  ];

  it.each(START_PATHS)('%s calls finaliseRun and never rewrites workflow_nodes config', (rel) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(src).toMatch(/\bfinaliseRun\(/);
    expect(src).not.toMatch(/emit\(\s*'workflow_completed'/);
    expect(src).not.toMatch(/\.update\(\s*workflowNodes\s*\)/);
  });

  it.each(TRIGGERED_PATHS)('%s starts runs through startTriggeredRun, not its own engine.execute', (rel) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(src).toMatch(/\bstartTriggeredRun\(/);
    expect(src).not.toMatch(/engine\s*\.\s*execute\(/);
    expect(src).not.toMatch(/\.update\(\s*workflowNodes\s*\)/);
  });
});
