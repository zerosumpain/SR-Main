import { describe, it, expect } from 'vitest';
import { listMcpTools } from './server';

// NOTE: The plan template referenced `create_node`, `add_edge`, and `search_nodes` as
// canonical tool names. The actual workflows-domain tools in
// src/lib/workflows/site-tools/tools/workflows.ts are namespaced `workflow_*`
// (e.g. `workflow_add_node`, `workflow_add_edge`, `workflow_list_node_types`).
// Phase 1.5: listMcpTools() now returns the full registry (130+ tools), not just
// the 22 workflows-domain tools. Toolset filtering is handled by Hermes skills.

describe('mcp/server', () => {
  it('lists the full tool registry (>= 50)', async () => {
    const tools = await listMcpTools();
    expect(tools.length).toBeGreaterThanOrEqual(50);
    expect(tools.find((t) => t.name === 'workflow_add_node')).toBeTruthy();
    expect(tools.find((t) => t.name === 'workflow_add_edge')).toBeTruthy();
    expect(tools.find((t) => t.name === 'blog_list')).toBeTruthy();
  });
});
