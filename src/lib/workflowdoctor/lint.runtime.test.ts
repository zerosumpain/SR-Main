import { describe, expect, it, vi } from 'vitest';

/**
 * The doctor lints against SR-Workflows' registry, not a copy of it: the graph
 * runs there, dynamic nodes included, and only that engine can say a type is
 * dead.
 */
const invoke = vi.fn();
vi.mock('$lib/workflows/runtime-client', () => ({ invokeWorkflowRuntime: (a: unknown) => invoke(a) }));
const graph = {
  nodes: [{ id: 'a', type: 'renamed-away', label: 'A', config: {}, position: { x: 0, y: 0 } }],
  edges: [],
};
vi.mock('$lib/workflows/start-run', () => ({ loadDefinition: async () => graph }));

const { lintWorkflow } = await import('./lint');

describe('lintWorkflow', () => {
  it('asks the Workflows runtime, with dead types, and no trigger', async () => {
    invoke.mockResolvedValue([
      { nodeId: 'a', nodeLabel: 'A', field: 'type', issue: 'No executor found for node type: renamed-away.', severity: 'error' },
    ]);
    const lint = await lintWorkflow('wf-1');
    expect(invoke).toHaveBeenCalledWith({ action: 'lint', nodes: graph.nodes, edges: graph.edges, deadTypes: true });
    expect(lint.errorCount).toBe(1);
    expect(lint.byNodeId.a[0].issue).toMatch(/^No executor found for node type: renamed-away/);
  });
});
