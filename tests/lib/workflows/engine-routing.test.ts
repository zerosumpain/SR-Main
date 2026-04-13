import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '$lib/workflows/engine';
import { NodeRegistry } from '$lib/workflows/registry';
import { manualTriggerDef, manualTriggerExecutor } from '$lib/workflows/nodes/manual-trigger';
import { transformDef, transformExecutor } from '$lib/workflows/nodes/transform';
import { conditionalDef, conditionalExecutor } from '$lib/workflows/nodes/conditional';
import type { WorkflowDefinition } from '$lib/workflows/types';

function makeEngine() {
  const registry = new NodeRegistry();
  registry.register(manualTriggerDef, manualTriggerExecutor);
  registry.register(transformDef, transformExecutor);
  registry.register(conditionalDef, conditionalExecutor);
  return new WorkflowEngine(registry);
}

describe('conditional routing', () => {
  it('executes only the true branch when condition is met', async () => {
    const engine = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Conditional Test',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 'cond', type: 'conditional', position: { x: 200, y: 0 }, config: { expression: 'input.x > 5' }, label: 'Check' },
        { id: 'truePath', type: 'transform', position: { x: 400, y: -50 }, config: { expression: 'return { result: "true branch" }' }, label: 'True' },
        { id: 'falsePath', type: 'transform', position: { x: 400, y: 50 }, config: { expression: 'return { result: "false branch" }' }, label: 'False' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'cond' },
        { id: 'e2', sourceNodeId: 'cond', targetNodeId: 'truePath', sourceHandle: 'true' },
        { id: 'e3', sourceNodeId: 'cond', targetNodeId: 'falsePath', sourceHandle: 'false' },
      ],
    };

    const result = await engine.execute(workflow, 'run-cond-1', { x: 10 });

    expect(result.status).toBe('completed');
    expect(result.nodeOutputs.get('truePath')).toEqual({ result: 'true branch' });
    expect(result.nodeOutputs.has('falsePath')).toBe(false); // skipped
  });

  it('executes only the false branch when condition is not met', async () => {
    const engine = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w2',
      name: 'Conditional Test False',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 'cond', type: 'conditional', position: { x: 200, y: 0 }, config: { expression: 'input.x > 5' }, label: 'Check' },
        { id: 'truePath', type: 'transform', position: { x: 400, y: -50 }, config: { expression: 'return { result: "true branch" }' }, label: 'True' },
        { id: 'falsePath', type: 'transform', position: { x: 400, y: 50 }, config: { expression: 'return { result: "false branch" }' }, label: 'False' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'cond' },
        { id: 'e2', sourceNodeId: 'cond', targetNodeId: 'truePath', sourceHandle: 'true' },
        { id: 'e3', sourceNodeId: 'cond', targetNodeId: 'falsePath', sourceHandle: 'false' },
      ],
    };

    const result = await engine.execute(workflow, 'run-cond-2', { x: 3 });

    expect(result.status).toBe('completed');
    expect(result.nodeOutputs.get('falsePath')).toEqual({ result: 'false branch' });
    expect(result.nodeOutputs.has('truePath')).toBe(false); // skipped
  });
});
