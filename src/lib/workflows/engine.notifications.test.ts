import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeRegistry } from './registry';
import type { WorkflowDefinition, NodeExecutor } from './types';

// Spy on the D1 run-outcome notifier — we only assert the engine calls it at
// the terminal seam with the right status; the notifier's own behaviour is
// covered in run-notifications.test.ts. `vi.hoisted` so the spy exists before
// the hoisted vi.mock factory references it.
const { notifyRunOutcome } = vi.hoisted(() => ({
  notifyRunOutcome: vi.fn(async (_args: unknown) => {}),
}));
vi.mock('./run-notifications', () => ({ notifyRunOutcome }));

// The engine (and engine-runtime's heartbeat/persist) touch $lib/db. A chainable
// no-op proxy that resolves to [] satisfies every drizzle call shape used on the
// execute path without a real database.
vi.mock('$lib/db', () => {
  function makeChain(): unknown {
    const resolved = Promise.resolve([]);
    const proxy: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') return resolved.then.bind(resolved);
        if (prop === 'catch') return resolved.catch.bind(resolved);
        if (prop === 'finally') return resolved.finally.bind(resolved);
        return () => proxy;
      },
      apply() {
        return proxy;
      },
    });
    return proxy;
  }
  return { db: makeChain() };
});

import { WorkflowEngine } from './engine';

function makeRegistry(executors: Record<string, NodeExecutor>): NodeRegistry {
  return {
    getExecutor: (type: string) => executors[type],
    getDefinition: () => undefined,
  } as unknown as NodeRegistry;
}

function singleNodeWorkflow(type: string): WorkflowDefinition {
  return {
    id: 'wf1',
    name: 'canvas:demo',
    nodes: [{ id: 'n1', type, config: {}, label: type, position: { x: 0, y: 0 } }],
    edges: [],
  } as unknown as WorkflowDefinition;
}

beforeEach(() => {
  notifyRunOutcome.mockClear();
});

describe('engine → notifyRunOutcome wiring', () => {
  it('notifies with status "completed" on a clean run, passing terminal outputs', async () => {
    const registry = makeRegistry({
      ok: {
        type: 'ok',
        execute: async () => ({ output: { result: 'hi' } }),
      } as unknown as NodeExecutor,
    });
    const engine = new WorkflowEngine(registry);

    const res = await engine.execute(
      singleNodeWorkflow('ok'),
      'run-ok',
      {},
      undefined,
      'wf1',
      { selfHealing: false },
    );

    expect(res.status).toBe('completed');
    expect(notifyRunOutcome).toHaveBeenCalledTimes(1);
    const arg = notifyRunOutcome.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.status).toBe('completed');
    expect(arg.workflowId).toBe('wf1');
    expect(arg.workflowName).toBe('canvas:demo');
    expect(arg.terminalOutputs).toMatchObject({ result: 'hi' });
  });

  it('notifies with status "failed" (and the error) when a node throws', async () => {
    const registry = makeRegistry({
      boom: {
        type: 'boom',
        execute: async () => {
          throw new Error('kaboom');
        },
      } as unknown as NodeExecutor,
    });
    const engine = new WorkflowEngine(registry);

    const res = await engine.execute(
      singleNodeWorkflow('boom'),
      'run-boom',
      {},
      undefined,
      'wf1',
      { selfHealing: false },
    );

    expect(res.status).toBe('failed');
    expect(notifyRunOutcome).toHaveBeenCalled();
    const arg = notifyRunOutcome.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(arg.status).toBe('failed');
    expect(String(arg.error)).toContain('kaboom');
  });
});
