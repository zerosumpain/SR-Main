import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ONLY loadStoreSnapshot so the {{state.*}} snapshot is controllable
// without a real DB; the rest of data-store (used by dedupe) stays real.
const H = vi.hoisted(() => ({ loadStoreSnapshot: vi.fn() }));
vi.mock('$lib/workflows/nodes/data-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/workflows/nodes/data-store')>();
  return { ...actual, loadStoreSnapshot: H.loadStoreSnapshot };
});

const { WorkflowEngine } = await import('$lib/workflows/engine');
const { NodeRegistry } = await import('$lib/workflows/registry');
const { manualTriggerDef, manualTriggerExecutor } = await import('$lib/workflows/nodes/manual-trigger');
import type {
  WorkflowDefinition,
  WorkflowEvent,
  NodeDefinition,
  NodeExecutor,
} from '$lib/workflows/types';

// A test-only node that records the exact config the engine hands it.
const captured: Record<string, unknown>[] = [];
const captureDef: NodeDefinition = {
  type: 'capture',
  label: 'Capture',
  category: 'core',
  description: 'records config',
  configSchema: { type: 'object' },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any' }],
  outputs: [{ name: 'output', type: 'any' }],
};
const captureExecutor: NodeExecutor = {
  type: 'capture',
  async execute(_input, config) {
    captured.push(config);
    return { output: { echoed: config }, rowCount: 1 };
  },
  getInputSchema: () => ({ type: 'object' }),
  getOutputSchema: () => ({ type: 'object' }),
};

function makeEngine() {
  const registry = new NodeRegistry();
  registry.register(manualTriggerDef, manualTriggerExecutor);
  registry.register(captureDef, captureExecutor);
  return new WorkflowEngine(registry);
}

beforeEach(() => {
  captured.length = 0;
  H.loadStoreSnapshot.mockReset();
});

describe('engine — {{state.*}} / {{today}} / {{now}} pre-resolution', () => {
  it('resolves state + builtins into a config copy, leaves {{input.*}} for the executor, and never mutates the persisted config', async () => {
    H.loadStoreSnapshot.mockResolvedValue(
      new Map<string, unknown>([
        ['cursor', 'C1'],
        ['profile', { name: 'Ada' }],
      ]),
    );

    const engine = makeEngine();
    const originalMessage =
      'today={{today}} now={{now}} cursor={{state.cursor}} name={{state.profile.name}} ' +
      'missing={{state.missing}} in={{input.foo}} bad={{trigger.output.x}}';
    const workflow: WorkflowDefinition = {
      id: 'wf-state',
      name: 'State',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        {
          id: 'capture',
          type: 'capture',
          position: { x: 200, y: 0 },
          config: { message: originalMessage, nested: { arr: ['{{now}}'] } },
          label: 'Capture',
        },
      ],
      edges: [{ id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'capture' }],
    };

    const events: WorkflowEvent[] = [];
    engine.onEvent('run-state', (e) => events.push(e));
    const result = await engine.execute(workflow, 'run-state', { foo: 'bar' });

    expect(result.status).toBe('completed');
    expect(H.loadStoreSnapshot).toHaveBeenCalledTimes(1);

    const msg = captured[0].message as string;
    // state resolved (exact key + dot-path)
    expect(msg).toContain('cursor=C1');
    expect(msg).toContain('name=Ada');
    // builtins resolved
    expect(msg).not.toContain('{{today}}');
    expect(msg).not.toContain('{{now}}');
    expect(msg).toMatch(/now=\d{4}-\d{2}-\d{2}T/);
    // unresolved state left verbatim
    expect(msg).toContain('missing={{state.missing}}');
    // input + unknown namespace left verbatim (executor / warning-only)
    expect(msg).toContain('in={{input.foo}}');
    expect(msg).toContain('bad={{trigger.output.x}}');
    // nested {{now}} resolved
    expect((captured[0].nested as { arr: string[] }).arr[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Persisted node config is untouched (only the copy was resolved).
    expect(workflow.nodes[1].config.message).toBe(originalMessage);
    expect((workflow.nodes[1].config.nested as { arr: string[] }).arr[0]).toBe('{{now}}');

    // node_warning emitted for the unresolvable tokens, but NOT for present input.
    const warnEvt = events.find((e) => e.type === 'node_warning');
    expect(warnEvt).toBeDefined();
    const warnings = (warnEvt as { data?: { warnings?: { token: string }[] } }).data?.warnings ?? [];
    const tokens = warnings.map((w) => w.token).sort();
    expect(tokens).toEqual(['state.missing', 'trigger.output.x']);

    // Warnings also surfaced on the stored node output for the inspector.
    const out = result.nodeOutputs.get('capture') as Record<string, unknown>;
    expect(Array.isArray(out._warnings)).toBe(true);
  });

  it('skips the store snapshot entirely when no node references {{state.*}}', async () => {
    const engine = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'wf-nostate',
      name: 'NoState',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        {
          id: 'capture',
          type: 'capture',
          position: { x: 200, y: 0 },
          config: { message: 'on {{today}} for {{input.foo}}' },
          label: 'Capture',
        },
      ],
      edges: [{ id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'capture' }],
    };

    const result = await engine.execute(workflow, 'run-nostate', { foo: 'bar' });
    expect(result.status).toBe('completed');
    // {{today}} still resolved without any DB hit.
    expect(captured[0].message).toMatch(/^on \w+ \d{1,2} \w+ \d{4} for \{\{input\.foo\}\}$/);
    expect(H.loadStoreSnapshot).not.toHaveBeenCalled();
    // No unknown/missing tokens → no _warnings key attached.
    const out = result.nodeOutputs.get('capture') as Record<string, unknown>;
    expect('_warnings' in (out.echoed as Record<string, unknown>)).toBe(false);
    expect('_warnings' in out).toBe(false);
  });
});
