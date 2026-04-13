import { describe, it, expect, vi } from 'vitest';
import { WorkflowEngine } from '$lib/workflows/engine';
import { NodeRegistry } from '$lib/workflows/registry';
import { manualTriggerDef, manualTriggerExecutor } from '$lib/workflows/nodes/manual-trigger';
import { transformDef, transformExecutor } from '$lib/workflows/nodes/transform';
import type { WorkflowDefinition, WorkflowEvent } from '$lib/workflows/types';

function makeEngine() {
  const registry = new NodeRegistry();
  registry.register(manualTriggerDef, manualTriggerExecutor);
  registry.register(transformDef, transformExecutor);
  return new WorkflowEngine(registry);
}

describe('engine inputData capture', () => {
  it('returns inputData for each node in result', async () => {
    const engine = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Test',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 'transform', type: 'transform', position: { x: 200, y: 0 }, config: { expression: 'return { doubled: input.value * 2 }' }, label: 'Double' },
      ],
      edges: [{ id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'transform' }],
    };

    const result = await engine.execute(workflow, 'run-bp-1', { value: 5 });

    expect(result.nodeInputs).toBeDefined();
    expect(result.nodeInputs.get('transform')).toEqual({ value: 5 });
  });
});

describe('engine breakpoints', () => {
  it('pauses at a breakpointed node and resumes when resolver is called', async () => {
    const engine = makeEngine();
    const events: WorkflowEvent[] = [];
    engine.onEvent('run-bp-2', (e) => events.push(e));

    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Test',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 'transform', type: 'transform', position: { x: 200, y: 0 }, config: { expression: 'return { doubled: input.value * 2 }' }, label: 'Double' },
      ],
      edges: [{ id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'transform' }],
    };

    const breakpoints = new Set(['transform']);
    const executePromise = engine.execute(workflow, 'run-bp-2', { value: 5 }, breakpoints);

    // Wait for breakpoint_hit event
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'breakpoint_hit' && e.nodeId === 'transform')).toBe(true);
    }, { timeout: 2000 });

    // Resume — provide modified input data
    engine.resumeBreakpoint('run-bp-2', 'transform', { value: 10 });

    const result = await executePromise;
    expect(result.status).toBe('completed');
    expect(result.nodeOutputs.get('transform')).toEqual({ doubled: 20 });
  });

  it('getBreakpointResolver returns undefined for non-paused node', () => {
    const engine = makeEngine();
    expect(engine.getBreakpointResolver('nonexistent-run', 'nonexistent-node')).toBeUndefined();
  });
});
