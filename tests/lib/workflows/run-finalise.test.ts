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

  it('a TEST run announces nothing and proposes no fix', async () => {
    await finaliseRun({ workflowId: 'wf', runId: 'r1', runStartedAt: Date.now(), result: result({ healingHistory: [heal] }), test: true });
    expect(emitPlatform).not.toHaveBeenCalled();
    expect(recordFixProposalsFromHealing).not.toHaveBeenCalled();
    expect(writes.updates.find((u) => u.table === 'workflow_runs')?.set.status).toBe('completed');
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

// One run kernel. Every start path — the Run button, the scheduler, webhooks,
// events, gmail/whatsapp, canvas chat, the single-node re-run, the workflow_run
// tool, sub-workflow children, the worker, resume and recovery — goes through
// start-run.ts, so nothing else may execute the engine, finalise a run, or
// write a run row. Read as source: the paths are routes and detached promises.
describe('the run kernel is the only start path', () => {
  const SRC = path.resolve(__dirname, '../../../src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|svelte)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(full);
    }
  };
  walk(SRC);
  const users = (re: RegExp) =>
    files.filter((f) => re.test(fs.readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, ''))).map((f) => path.relative(SRC, f)).sort();

  it('only start-run.ts executes the engine (plus the generator\'s draft dry-run, which has no run row)', () => {
    expect(users(/\bengine\s*\.\s*execute\(/)).toEqual(['lib/workflows/orchestrator/index.ts', 'lib/workflows/start-run.ts']);
  });

  it('only start-run.ts finalises a run or inserts a run row', () => {
    expect(users(/\bfinaliseRun\(/)).toEqual(['lib/workflows/run-finalise.ts', 'lib/workflows/start-run.ts']);
    expect(users(/insert\(\s*workflowRuns\s*\)/)).toEqual(['lib/workflows/start-run.ts']);
  });

  it('the kernel never writes a heal back to the saved node', () => {
    const src = fs.readFileSync(path.join(SRC, 'lib/workflows/start-run.ts'), 'utf8');
    expect(src).not.toMatch(/\.update\(\s*workflowNodes\s*\)/);
  });
});
