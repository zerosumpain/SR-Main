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

const { interpolateTemplate } = await import('$lib/workflows/nodes/template');

// A test-only node that records the exact config + input the engine hands it,
// and what its own per-executor interpolation makes of `message`.
const captured: Record<string, unknown>[] = [];
const inputs: Record<string, unknown>[] = [];
const reinterpolated: string[] = [];
const base: Pick<NodeDefinition, 'category' | 'description' | 'defaultConfig' | 'inputs' | 'outputs'> = {
  category: 'core',
  description: 'test',
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any' }],
  outputs: [{ name: 'output', type: 'any' }],
};
const captureDef: NodeDefinition = {
  ...base,
  type: 'capture',
  label: 'Capture',
  configSchema: { type: 'object', properties: { message: { type: 'string' }, list: { type: 'array' } } },
  rawConfigKeys: ['code'],
};
const captureExecutor: NodeExecutor = {
  type: 'capture',
  async execute(input, config) {
    captured.push(config);
    inputs.push(input);
    reinterpolated.push(interpolateTemplate(config.message, input));
    return { output: { echoed: config }, rowCount: 1 };
  },
  getInputSchema: () => ({ type: 'object' }),
  getOutputSchema: () => ({ type: 'object' }),
};
// Emits its (typed) `payload` config as its output.
const emitDef: NodeDefinition = {
  ...base,
  type: 'emit',
  label: 'Emit',
  configSchema: { type: 'object', properties: { payload: { type: 'object' } } },
};
const emitExecutor: NodeExecutor = {
  type: 'emit',
  async execute(_input, config) {
    return { output: { ...(config.payload as Record<string, unknown>) }, rowCount: 1 };
  },
  getInputSchema: () => ({ type: 'object' }),
  getOutputSchema: () => ({ type: 'object' }),
};

function makeEngine() {
  const registry = new NodeRegistry();
  registry.register(manualTriggerDef, manualTriggerExecutor);
  registry.register(captureDef, captureExecutor);
  registry.register(emitDef, emitExecutor);
  return new WorkflowEngine(registry);
}

beforeEach(() => {
  captured.length = 0;
  inputs.length = 0;
  reinterpolated.length = 0;
  H.loadStoreSnapshot.mockReset();
});

describe('engine — template resolution before the executor runs', () => {
  it('resolves state, builtins and input into a config copy, and never mutates the persisted config', async () => {
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
    // unknown references become empty; input resolved by the engine
    expect(msg).toContain('missing= ');
    expect(msg).toContain('in=bar');
    expect(msg).toMatch(/bad=$/);
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
    // The executor's own helper sees the already-resolved text and leaves it.
    expect(reinterpolated[0]).toBe(msg);

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
    expect(captured[0].message).toMatch(/^on \w+ \d{1,2} \w+ \d{4} for bar$/);
    expect(H.loadStoreSnapshot).not.toHaveBeenCalled();
    // No unknown/missing tokens → no _warnings key attached.
    const out = result.nodeOutputs.get('capture') as Record<string, unknown>;
    expect('_warnings' in (out.echoed as Record<string, unknown>)).toBe(false);
    expect('_warnings' in out).toBe(false);
  });

  const node = (id: string, type: string, label: string, config: Record<string, unknown>) => ({
    id, type, label, config, position: { x: 0, y: 0 },
  });

  it('resolves {{nodes.X}} by id and label slug, {{trigger.*}}, typed values, and keeps branches apart', async () => {
    const engine = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'wf-nodes',
      name: 'Nodes',
      nodes: [
        node('trigger', 'manual-trigger', 'Start', {}),
        node('a', 'emit', 'Fetch Accounts', { payload: { json: { results: ['acc1'] }, status: 200 } }),
        node('b', 'emit', 'Fetch Cards', { payload: { json: { results: ['card1', 'card2'] }, status: 201 } }),
        node('c', 'capture', 'Capture', {
          message: 'acc={{nodes.a.json.results[0]}} cards={{nodes.fetch-cards.output.json.results | join}} ' +
            'n={{nodes.fetch-cards.json.results | length}} who={{trigger.who}} {{input.missing ?? "dflt"}}',
          list: '{{nodes.b.json.results}}',
          code: 'return "{{input.status}}"',
        }),
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'a' },
        { id: 'e2', sourceNodeId: 'trigger', targetNodeId: 'b' },
        { id: 'e3', sourceNodeId: 'a', targetNodeId: 'c', targetHandle: 'accounts' },
        { id: 'e4', sourceNodeId: 'b', targetNodeId: 'c' },
      ],
    };
    const result = await engine.execute(workflow, 'run-nodes', { who: 'john' });
    expect(result.status).toBe('completed');
    expect(captured[0].message).toBe('acc=acc1 cards=card1, card2 n=2 who=john dflt');
    expect(captured[0].list).toEqual(['card1', 'card2']);
    expect(captured[0].code).toBe('return "{{input.status}}"');

    const input = inputs[0] as Record<string, unknown> & { $from: Record<string, unknown>; $ports: Record<string, unknown> };
    // Flat merge unchanged (last writer wins)...
    expect(input.status).toBe(201);
    // ...but every branch is still readable on its own.
    expect(input.$from.a).toEqual({ json: { results: ['acc1'] }, status: 200 });
    expect(input.$from['fetch-accounts']).toBe(input.$from.a);
    expect(input.$from.b).toEqual({ json: { results: ['card1', 'card2'] }, status: 201 });
    expect(input.$ports.accounts).toBe(input.$from.a);
    // Hidden: not spread, not persisted as input_data.
    expect(Object.keys(input)).not.toContain('$from');
    expect(JSON.stringify(result.nodeInputs.get('c'))).not.toContain('$from');
  });

  it('never resolves inside upstream DATA that happens to contain braces', async () => {
    const engine = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'wf-data',
      name: 'Data',
      nodes: [
        node('trigger', 'manual-trigger', 'Start', {}),
        node('c', 'capture', 'Capture', { message: 'said: {{input.text}} / {{nodes.trigger.text}}' }),
      ],
      edges: [{ id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'c' }],
    };
    const result = await engine.execute(workflow, 'run-data', { text: 'hi {{input.secret}} {{today}}', secret: 'LEAK' });
    expect(result.status).toBe('completed');
    const expected = 'said: hi {{input.secret}} {{today}} / hi {{input.secret}} {{today}}';
    expect(captured[0].message).toBe(expected);
    expect(reinterpolated[0]).toBe(expected);
  });
});
