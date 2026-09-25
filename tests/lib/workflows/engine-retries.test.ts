import { describe, it, expect, vi, beforeEach } from 'vitest';

// Engine-level: typed retries with backoff, the `running` row written before a
// node's side effect, no self-healing for transient failures, and child runs
// that never queue for a top-level slot.

const state = vi.hoisted(() => ({ nodeWrites: [] as Array<Record<string, unknown>> }));
vi.mock('$lib/db', () => ({
  db: {
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => void (('status' in v) && state.nodeWrites.push(v)),
      }),
    }),
  },
}));
const diagnoseAndFix = vi.hoisted(() => vi.fn(async () => ({ category: 'unknown', diagnosis: 'no idea', fix: null })));
vi.mock('$lib/workflows/orchestrator/healing', () => ({ diagnoseAndFix }));
vi.mock('$lib/workflows/run-notifications', () => ({ notifyRunOutcome: vi.fn(async () => {}) }));
// No real waiting between attempts.
vi.mock('$lib/workflows/errors', async (orig) => {
  const real = await orig<typeof import('$lib/workflows/errors')>();
  return { ...real, runWithRetries: (fn: never, policy: never, opts: Record<string, unknown> = {}) => real.runWithRetries(fn, policy, { ...opts, sleep: async () => {} }) };
});
const acquireRunSlot = vi.hoisted(() => vi.fn(async () => () => {}));
vi.mock('$lib/workflows/engine-runtime', async (orig) => ({
  ...(await orig<typeof import('$lib/workflows/engine-runtime')>()),
  acquireRunSlot,
  startHeartbeat: () => () => {},
}));

import { WorkflowEngine } from '$lib/workflows/engine';
import { NodeRegistry } from '$lib/workflows/registry';
import { FatalError } from '$lib/workflows/errors';
import type { NodeDefinition, WorkflowDefinition } from '$lib/workflows/types';

const def = (type: string, idempotent: boolean): NodeDefinition => ({
  type, label: type, category: 'core', description: '', configSchema: { type: 'object' }, defaultConfig: {},
  inputs: [], outputs: [], idempotent,
});

function harness(fail: () => Error | null, idempotent: boolean) {
  const calls = { n: 0 };
  const registry = new NodeRegistry();
  registry.register(def('flaky', idempotent), {
    type: 'flaky',
    async execute() {
      calls.n++;
      const e = fail();
      if (e) throw e;
      return { output: { ok: true } };
    },
    getInputSchema: () => ({ type: 'object' }),
    getOutputSchema: () => ({ type: 'object' }),
  });
  return { engine: new WorkflowEngine(registry), calls };
}

const wf = (config: Record<string, unknown> = {}): WorkflowDefinition => ({
  id: 'wf', name: 'wf', nodes: [{ id: 'n', type: 'flaky', config, label: 'n', position: { x: 0, y: 0 } }], edges: [],
});

beforeEach(() => {
  state.nodeWrites = [];
  diagnoseAndFix.mockClear();
  acquireRunSlot.mockClear();
});

describe('engine retries', () => {
  it('retries a transient failure on an idempotent node and succeeds', async () => {
    let n = 0;
    const { engine, calls } = harness(() => (++n < 3 ? new TypeError('fetch failed') : null), true);
    const r = await engine.execute(wf(), 'run-1', {});
    expect(r.status).toBe('completed');
    expect(calls.n).toBe(3);
  });

  it('does not auto-retry a side-effecting node, and does not self-heal a transient failure', async () => {
    const { engine, calls } = harness(() => new Error('HTTP 503 Service Unavailable'), false);
    const r = await engine.execute(wf(), 'run-2', {});
    expect(r.status).toBe('failed');
    expect(calls.n).toBe(1);
    expect(diagnoseAndFix).not.toHaveBeenCalled();
  });

  it('never retries a FatalError, even in _onError retry mode — but may heal it', async () => {
    const { engine, calls } = harness(() => new FatalError('No operation configured'), true);
    const r = await engine.execute(wf({ _onError: { mode: 'retry', retries: 4, retryDelayMs: 1 } }), 'run-3', {});
    expect(r.status).toBe('failed');
    expect(calls.n).toBe(1);
    expect(diagnoseAndFix).toHaveBeenCalled();
  });

  it('_onError retry mode keeps its meaning for unknown errors', async () => {
    let n = 0;
    const { engine, calls } = harness(() => (++n < 3 ? new Error('weird') : null), false);
    const r = await engine.execute(wf({ _onError: { mode: 'retry', retries: 2, retryDelayMs: 1 } }), 'run-4', {});
    expect(r.status).toBe('completed');
    expect(calls.n).toBe(3);
  });
});

describe('engine run bookkeeping', () => {
  it("marks the node's row running before the executor is called, then completed", async () => {
    const { engine } = harness(() => null, true);
    await engine.execute(wf(), 'run-5', {});
    await vi.waitFor(() => expect(state.nodeWrites.map((w) => w.status)).toEqual(['running', 'completed']));
    expect(state.nodeWrites[0].completedAt).toBeUndefined();
  });

  it('a child run never queues for a top-level slot', async () => {
    const { engine } = harness(() => null, true);
    await engine.execute(wf(), 'run-6', {}, undefined, 'wf', { child: true });
    expect(acquireRunSlot).not.toHaveBeenCalled();
    await engine.execute(wf(), 'run-7', {}, undefined, 'wf');
    expect(acquireRunSlot).toHaveBeenCalledTimes(1);
  });
});
