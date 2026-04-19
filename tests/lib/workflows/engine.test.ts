import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowEngine } from '$lib/workflows/engine';
import { NodeRegistry } from '$lib/workflows/registry';
import { manualTriggerDef, manualTriggerExecutor } from '$lib/workflows/nodes/manual-trigger';
import { transformDef, transformExecutor } from '$lib/workflows/nodes/transform';
import type { WorkflowDefinition, WorkflowEvent } from '$lib/workflows/types';

function makeEngine(): { engine: WorkflowEngine; registry: NodeRegistry } {
  const registry = new NodeRegistry();
  registry.register(manualTriggerDef, manualTriggerExecutor);
  registry.register(transformDef, transformExecutor);
  const engine = new WorkflowEngine(registry);
  return { engine, registry };
}

describe('WorkflowEngine', () => {
  it('executes a simple two-node workflow', async () => {
    const { engine } = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Test',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 'transform', type: 'transform', position: { x: 200, y: 0 }, config: { expression: 'return { doubled: input.value * 2 }' }, label: 'Double' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'transform' },
      ],
    };

    const result = await engine.execute(workflow, 'run-1', { value: 5 });

    expect(result.status).toBe('completed');
    expect(result.nodeOutputs.get('transform')).toEqual({ doubled: 10 });
  });

  it('emits events during execution', async () => {
    const { engine } = makeEngine();
    const events: WorkflowEvent[] = [];
    engine.onEvent('run-2', (e) => events.push(e));

    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Test',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
      ],
      edges: [],
    };

    await engine.execute(workflow, 'run-2', {});

    const types = events.map((e) => e.type);
    expect(types).toContain('run_started');
    expect(types).toContain('node_started');
    expect(types).toContain('node_completed');
    expect(types).toContain('run_completed');
  });

  it('handles three-node chain', async () => {
    const { engine } = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Chain',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 't1', type: 'transform', position: { x: 200, y: 0 }, config: { expression: 'return { x: (input.x || 1) + 1 }' }, label: 'Add1' },
        { id: 't2', type: 'transform', position: { x: 400, y: 0 }, config: { expression: 'return { x: input.x * 10 }' }, label: 'Mult10' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 't1' },
        { id: 'e2', sourceNodeId: 't1', targetNodeId: 't2' },
      ],
    };

    const result = await engine.execute(workflow, 'run-3', { x: 1 });

    expect(result.nodeOutputs.get('t1')).toEqual({ x: 2 });
    expect(result.nodeOutputs.get('t2')).toEqual({ x: 20 });
  });

  it('reports failure when node throws', async () => {
    const { engine } = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Fail',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 't1', type: 'transform', position: { x: 200, y: 0 }, config: { expression: 'throw new Error("kaboom")' }, label: 'Boom' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 't1' },
      ],
    };

    // selfHealing: false to skip LLM calls in test
    const result = await engine.execute(workflow, 'run-4', {}, undefined, undefined, { selfHealing: false });

    expect(result.status).toBe('failed');
    expect(result.nodeErrors.get('t1')).toContain('kaboom');
  });

  it('fails on unknown node type', async () => {
    const { engine } = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Unknown',
      nodes: [
        { id: 'n1', type: 'nonexistent', position: { x: 0, y: 0 }, config: {}, label: 'Bad' },
      ],
      edges: [],
    };

    const result = await engine.execute(workflow, 'run-5', {});
    expect(result.status).toBe('failed');
    expect(result.error).toContain('nonexistent');
  });

  it('merges outputs from multiple upstream nodes', async () => {
    const { engine } = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Fan-in',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 'a', type: 'transform', position: { x: 200, y: -50 }, config: { expression: 'return { a: 1 }' }, label: 'A' },
        { id: 'b', type: 'transform', position: { x: 200, y: 50 }, config: { expression: 'return { b: 2 }' }, label: 'B' },
        { id: 'merge', type: 'transform', position: { x: 400, y: 0 }, config: { expression: 'return { sum: input.a + input.b }' }, label: 'Merge' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'a' },
        { id: 'e2', sourceNodeId: 'trigger', targetNodeId: 'b' },
        { id: 'e3', sourceNodeId: 'a', targetNodeId: 'merge' },
        { id: 'e4', sourceNodeId: 'b', targetNodeId: 'merge' },
      ],
    };

    const result = await engine.execute(workflow, 'run-6', {});

    expect(result.nodeOutputs.get('merge')).toEqual({ sum: 3 });
  });
});
