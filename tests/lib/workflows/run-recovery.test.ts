import { describe, it, expect, vi, beforeEach } from 'vitest';
import { planRecovery } from '$lib/workflows/resume-seed';

// Crash / deploy recovery: a run whose process died resumes ONCE from its
// persisted outputs against its pinned version — unless a side-effecting step
// was cut off mid-flight, in which case it fails rather than risk a double send.

const state = vi.hoisted(() => ({
  runs: {} as Record<string, Record<string, unknown>>,
  execs: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  claimOk: true,
}));

vi.mock('$lib/db/schema', () => ({
  workflowRuns: { __t: 'runs', id: 'id', status: 'status', resumeCount: 'resumeCount' },
  nodeExecutions: { __t: 'execs', runId: 'runId', nodeId: 'nodeId' },
  workflowInteractions: { __t: 'interactions' },
}));
vi.mock('drizzle-orm', () => ({
  eq: (_c: unknown, v: unknown) => ({ v }),
  and: (...a: Array<{ v?: unknown }>) => a[0],
  inArray: () => ({}),
  isNull: () => ({}),
}));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: (t: { __t: string }) => ({
        where: async (w: { v?: string }) => (t.__t === 'runs' ? (state.runs[w.v!] ? [state.runs[w.v!]] : []) : state.execs),
      }),
    }),
    update: (t: { __t: string }) => ({
      set: (set: Record<string, unknown>) => {
        state.updates.push({ table: t.__t, set });
        const p = Promise.resolve() as Promise<void> & { returning: () => Promise<unknown[]> };
        p.returning = async () => (state.claimOk ? [{ id: 'x' }] : []);
        return { where: () => p };
      },
    }),
  },
}));

const registry = vi.hoisted(() => ({
  getDefinition: (type: string) => ({ idempotent: type === 'http-get' || type === 'transform' }),
  getExecutor: () => null,
}));
vi.mock('$lib/workflows', () => ({ registry }));
vi.mock('$lib/workflows/events', () => ({ emitWorkflowEvent: vi.fn() }));
const upsertNodeExecution = vi.hoisted(() => vi.fn(async () => {}));
const failRun = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/workflows/run-finalise', () => ({ upsertNodeExecution, failRun }));
const executeRun = vi.hoisted(() => vi.fn(async () => null));
const definition = {
  id: 'wf', name: 'wf',
  nodes: [
    { id: 't', type: 'trigger', config: {}, label: 't', position: { x: 0, y: 0 } },
    { id: 'get', type: 'http-get', config: {}, label: 'get', position: { x: 0, y: 0 } },
    { id: 'send', type: 'whatsapp', config: {}, label: 'send', position: { x: 0, y: 0 } },
    { id: 'sub', type: 'sub-workflow', config: { workflowId: 'child-wf' }, label: 'sub', position: { x: 0, y: 0 } },
  ],
  edges: [],
};
const loadPinnedDefinition = vi.hoisted(() => vi.fn());
vi.mock('$lib/workflows/start-run', () => ({ executeRun, loadPinnedDefinition }));

import { recoverRun, continueParent } from '$lib/workflows/engine-resume';

const run = (over: Record<string, unknown> = {}) => ({
  id: 'r1', workflowId: 'wf', status: 'running', versionId: 'v1', resumeCount: 0,
  inputData: { q: 1 }, trigger: 'scheduled', parentRunId: null, startedAt: new Date(1000), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.runs = { r1: run() };
  state.execs = [];
  state.updates = [];
  state.claimOk = true;
  loadPinnedDefinition.mockResolvedValue(definition);
});

describe('planRecovery', () => {
  const idem = (id: string) => id === 'get';
  it('seeds completed steps with their branch, re-runs an idempotent step that was mid-flight', () => {
    const plan = planRecovery([
      { nodeId: 't', status: 'completed', outputData: { a: 1 }, selectedHandle: 'yes' },
      { nodeId: 'get', status: 'running', outputData: null },
      { nodeId: 'send', status: 'pending', outputData: null },
    ], idem);
    expect(plan).toEqual({ ok: true, seed: { outputs: { t: { a: 1 } }, handles: { t: 'yes' } }, rerun: ['get'] });
  });
  it('refuses when a side-effecting step was mid-flight', () => {
    const plan = planRecovery([{ nodeId: 'send', status: 'running', outputData: null }], idem);
    expect(plan).toMatchObject({ ok: false, interrupted: ['send'] });
  });
  it('refuses when a step had already failed', () => {
    expect(planRecovery([{ nodeId: 'get', status: 'failed', outputData: null }], idem)).toMatchObject({ ok: false });
  });
});

describe('recoverRun', () => {
  it('resumes once from persisted outputs against the pinned version', async () => {
    state.execs = [
      { nodeId: 't', status: 'completed', outputData: { a: 1 }, selectedHandle: null },
      { nodeId: 'get', status: 'running', outputData: null },
    ];
    expect(await recoverRun('r1', 'abandoned')).toBe('resumed');
    expect(loadPinnedDefinition).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'v1' }));
    expect(state.updates).toContainEqual({ table: 'runs', set: expect.objectContaining({ status: 'running', resumeCount: 1 }) });
    expect(state.updates).toContainEqual({ table: 'execs', set: { status: 'pending' } });
    expect(executeRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'r1', definition, input: { q: 1 }, seed: { outputs: { t: { a: 1 } }, handles: {} }, runStartedAt: 1000,
    }));
  });

  it('a deploy-drained paused run resumes through the same path', async () => {
    state.runs.r1 = run({ status: 'paused' });
    expect(await recoverRun('r1', 'abandoned')).toBe('resumed');
    expect(executeRun).toHaveBeenCalled();
  });

  it('fails a run whose side-effecting step was cut off, marking that step failed-unknown', async () => {
    state.execs = [{ nodeId: 'send', status: 'running', outputData: null }];
    expect(await recoverRun('r1', 'abandoned')).toBe('failed');
    expect(upsertNodeExecution).toHaveBeenCalledWith('r1', 'send', expect.objectContaining({ status: 'failed', error: expect.stringMatching(/may or may not have taken effect/) }));
    expect(state.updates).toContainEqual({ table: 'runs', set: expect.objectContaining({ status: 'failed', error: expect.stringMatching(/^abandoned; interrupted/) }) });
    expect(executeRun).not.toHaveBeenCalled();
  });

  it('never resumes twice', async () => {
    state.runs.r1 = run({ resumeCount: 1 });
    expect(await recoverRun('r1', 'abandoned')).toBe('failed');
    expect(executeRun).not.toHaveBeenCalled();
  });

  it('fails a run from before versions existed rather than guess at its graph', async () => {
    state.runs.r1 = run({ versionId: null });
    expect(await recoverRun('r1', 'abandoned')).toBe('failed');
    expect(executeRun).not.toHaveBeenCalled();
  });

  it('loses the claim race gracefully (another process resumed it)', async () => {
    state.claimOk = false;
    expect(await recoverRun('r1', 'abandoned')).toBe('skipped');
    expect(executeRun).not.toHaveBeenCalled();
  });

  it('leaves settled runs alone', async () => {
    state.runs.r1 = run({ status: 'completed' });
    expect(await recoverRun('r1', 'abandoned')).toBe('skipped');
  });
});

describe('continueParent', () => {
  const childResult = (status: string) => ({
    status, nodeOutputs: new Map([['end', { answer: 42 }]]), nodeErrors: new Map([['end', 'boom']]), error: 'kaput',
  }) as never;

  beforeEach(() => {
    state.runs = {
      parent: run({ id: 'parent', status: 'awaiting_human', pausedAtNodeId: 'sub' }),
      child: run({ id: 'child', workflowId: 'child-wf', parentRunId: 'parent' }),
    };
    loadPinnedDefinition.mockImplementation(async (r: { workflowId: string }) =>
      r.workflowId === 'child-wf' ? { id: 'child-wf', name: 'c', nodes: [{ id: 'end' }], edges: [] } : definition);
  });

  it('a completed child resumes its waiting parent with the child output', async () => {
    state.execs = [];
    await continueParent('parent', 'child', childResult('completed'));
    // resumeRun → re-enters the kernel for the PARENT with the sub step seeded.
    expect(executeRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'parent', seed: expect.objectContaining({ outputs: expect.objectContaining({ sub: { answer: 42 } }) }),
    }));
  });

  it('a failed child fails the waiting parent', async () => {
    await continueParent('parent', 'child', childResult('failed'));
    expect(upsertNodeExecution).toHaveBeenCalledWith('parent', 'sub', expect.objectContaining({ status: 'failed' }));
    expect(failRun).toHaveBeenCalledWith(expect.objectContaining({ runId: 'parent', error: 'Sub-workflow failed: kaput' }));
  });

  it('does nothing while the parent is still running (it is awaiting the child in process)', async () => {
    state.runs.parent.status = 'running';
    await continueParent('parent', 'child', childResult('completed'));
    expect(executeRun).not.toHaveBeenCalled();
    expect(failRun).not.toHaveBeenCalled();
  });
});
